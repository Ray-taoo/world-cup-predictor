import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const siteUrl = process.env.LOCAL_SITE_URL ?? "http://127.0.0.1:3000";
const stateDir = process.env.WORLD_CUP_DATA_DIR ?? path.join(process.cwd(), ".local");
const snapshotErrorPath = path.join(stateDir, "pre-match-snapshot-error.json");
const matchContextPath = path.join(stateDir, "match-context.json");
const liveFixturesPath = path.join(process.cwd(), "src", "data", "live-fixtures.json");

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "pipe",
    encoding: "utf8",
    shell: process.platform === "win32"
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

async function refreshOdds() {
  const response = await fetch(`${siteUrl}/api/odds/refresh`, { method: "POST" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error ?? `赔率刷新失败：${response.status}`);
  }
  return body;
}

async function main() {
  console.log("1/5 refresh FIFA ranking and Transfermarkt inputs");
  run("node", ["scripts/import-free-inputs.mjs"]);
  console.log("2/5 refresh recent match results");
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  run(npmCommand, ["run", "sync:worldcup:recent"]);
  console.log("3/5 refresh The Odds API odds including event BTTS");
  const odds = await refreshOdds();
  console.log(JSON.stringify({ oddsImported: odds.count ?? 0, siteUrl }, null, 2));
  console.log("4/5 refresh FotMob lineup/absence and Open-Meteo weather context");
  const context = await refreshMatchContext();
  console.log(JSON.stringify(context, null, 2));
  console.log("5/5 capture pre-match snapshots");
  runOptionalSnapshot(npmCommand, ["run", "snapshots:capture"]);
  console.log("local input refresh complete");
}

async function refreshMatchContext() {
  const live = JSON.parse(fs.readFileSync(liveFixturesPath, "utf8"));
  const fixtures = (live.fixtures ?? []).filter((match) =>
    new Date(match.sortDate).getTime() > Date.now() && !/winner|loser|runner-up|tbd|match \d+/i.test(`${match.home} ${match.away}`)
  );
  const existing = fs.existsSync(matchContextPath) ? JSON.parse(fs.readFileSync(matchContextPath, "utf8")) : { matches: [] };
  const byMatch = new Map((existing.matches ?? []).map((row) => [row.matchId, row]));
  const errors = [];
  const scheduleByDate = new Map();

  for (const fixture of fixtures) {
    const fetchedAt = new Date().toISOString();
    const previous = byMatch.get(fixture.id) ?? {};
    const row = { ...previous, matchId: fixture.id, home: fixture.home, away: fixture.away, kickoffTimeUtc: fixture.sortDate, venue: fixture.venue };
    try {
      const date = fixture.sortDate.slice(0, 10).replaceAll("-", "");
      if (!scheduleByDate.has(date)) scheduleByDate.set(date, await fetchJson(`https://www.fotmob.com/api/data/matches?date=${date}`));
      const event = findFotMobEvent(scheduleByDate.get(date), fixture);
      if (!event) throw new Error("fixture not found");
      const sourceUrl = `https://www.fotmob.com/api/data/matchDetails?matchId=${event.id}`;
      const detail = await fetchJson(sourceUrl);
      const lineup = detail.content?.lineup;
      if (!lineup?.homeTeam || !lineup?.awayTeam) throw new Error("lineup/absence payload missing");
      const incoming = {
        externalProvider: "FotMob",
        externalEventId: String(event.id),
        fetchedAt,
        sourceUrl,
        lineupType: lineup.lineupType ?? null,
        source: lineup.source ?? null,
        home: contextTeam(lineup.homeTeam, lineup.lineupType),
        away: contextTeam(lineup.awayTeam, lineup.lineupType)
      };
      row.squad = previous.squad?.home?.confirmedLineup && !incoming.home.confirmedLineup ? previous.squad : incoming;
    } catch (error) {
      errors.push({ matchId: fixture.id, source: "FotMob", error: error instanceof Error ? error.message : String(error) });
    }
    try {
      const weather = await fetchWeather(fixture, fetchedAt);
      if (weather) row.weather = weather;
    } catch (error) {
      errors.push({ matchId: fixture.id, source: "Open-Meteo", error: error instanceof Error ? error.message : String(error) });
    }
    byMatch.set(fixture.id, row);
  }

  const output = { updatedAt: new Date().toISOString(), matches: [...byMatch.values()], errors };
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(matchContextPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  return {
    matchesChecked: fixtures.length,
    injuryFeedsMatched: fixtures.filter((fixture) => byMatch.get(fixture.id)?.squad).length,
    confirmedLineupsMatched: fixtures.filter((fixture) => byMatch.get(fixture.id)?.squad?.home?.confirmedLineup && byMatch.get(fixture.id)?.squad?.away?.confirmedLineup).length,
    weatherMatched: fixtures.filter((fixture) => byMatch.get(fixture.id)?.weather).length,
    extremeWeatherMatches: fixtures.filter((fixture) => byMatch.get(fixture.id)?.weather?.extremeReasons?.length).map((fixture) => fixture.id),
    errors
  };
}

function findFotMobEvent(payload, fixture) {
  const events = (payload.leagues ?? []).flatMap((league) => league.matches ?? []);
  return events.find((event) =>
    normalizeName(event.home?.name) === normalizeName(fixture.home) &&
    normalizeName(event.away?.name) === normalizeName(fixture.away) &&
    Math.abs(new Date(event.status?.utcTime).getTime() - new Date(fixture.sortDate).getTime()) <= 3 * 60 * 60 * 1000
  );
}

function contextTeam(team, lineupType) {
  const unavailable = team.unavailable ?? [];
  const confirmedLineup = lineupType === "standard" && (team.starters ?? []).length === 11;
  return {
    teamName: team.name,
    injuries: unavailable.filter((player) => player.unavailability?.type === "injury").length,
    suspensions: unavailable.filter((player) => player.unavailability?.type === "suspension").length,
    keyAbsences: 0,
    confirmedLineup,
    projectedXIValueEurM: confirmedLineup ? (team.starters ?? []).reduce((sum, player) => sum + (Number(player.marketValue) || 0), 0) / 1_000_000 : null,
    unavailable: unavailable.map((player) => ({ name: player.name, reason: player.unavailability?.type ?? "unavailable" }))
  };
}

async function fetchWeather(fixture, fetchedAt) {
  const city = fixture.venue.split(",").at(-1)?.trim();
  if (!city) return null;
  const geocodeUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
  geocodeUrl.searchParams.set("name", city);
  geocodeUrl.searchParams.set("count", "1");
  geocodeUrl.searchParams.set("language", "en");
  geocodeUrl.searchParams.set("format", "json");
  const place = (await fetchJson(geocodeUrl)).results?.[0];
  if (!place) throw new Error(`venue city not found: ${city}`);
  const date = fixture.sortDate.slice(0, 10);
  const weatherUrl = new URL("https://api.open-meteo.com/v1/forecast");
  weatherUrl.searchParams.set("latitude", String(place.latitude));
  weatherUrl.searchParams.set("longitude", String(place.longitude));
  weatherUrl.searchParams.set("hourly", "temperature_2m,precipitation,wind_speed_10m,weather_code");
  weatherUrl.searchParams.set("timezone", "UTC");
  weatherUrl.searchParams.set("start_date", date);
  weatherUrl.searchParams.set("end_date", date);
  const payload = await fetchJson(weatherUrl);
  const hour = fixture.sortDate.slice(0, 13) + ":00";
  const index = payload.hourly?.time?.indexOf(hour) ?? -1;
  if (index < 0) throw new Error(`forecast hour not found: ${hour}`);
  const temperatureC = Number(payload.hourly.temperature_2m[index]);
  const precipitationMm = Number(payload.hourly.precipitation[index]);
  const windSpeedKmh = Number(payload.hourly.wind_speed_10m[index]);
  const extremeReasons = [];
  if (precipitationMm >= 5) extremeReasons.push("heavy_rain");
  if (windSpeedKmh >= 30) extremeReasons.push("strong_wind");
  if (temperatureC >= 35 || temperatureC <= 0) extremeReasons.push("extreme_temperature");
  const reduction = Math.min(0.06, Number(precipitationMm >= 5) * 0.04 + Number(windSpeedKmh >= 30) * 0.04 + Number(temperatureC >= 35 || temperatureC <= 0) * 0.03);
  return {
    source: "Open-Meteo",
    sourceUrl: "https://api.open-meteo.com/v1/forecast",
    fetchedAt,
    latitude: Number(place.latitude),
    longitude: Number(place.longitude),
    resolvedLocation: `${place.name}, ${place.admin1 ?? place.country ?? ""}`.replace(/, $/, ""),
    forecastTimeUtc: hour,
    temperatureC,
    precipitationMm,
    windSpeedKmh,
    weatherCode: Number(payload.hourly.weather_code[index]),
    extremeReasons,
    lambdaMultiplier: 1 - reduction
  };
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { "user-agent": "worldcup-predictor-local/1.0", accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function normalizeName(value) {
  return String(value ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/gi, " ").trim().toLowerCase();
}

function runOptionalSnapshot(command, args) {
  const result = spawnSync(command, args, { stdio: "pipe", encoding: "utf8", shell: process.platform === "win32" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status === 0) {
    if (fs.existsSync(snapshotErrorPath)) fs.rmSync(snapshotErrorPath);
    return true;
  }
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    snapshotErrorPath,
    `${JSON.stringify({ updatedAt: new Date().toISOString(), command: `${command} ${args.join(" ")}`, exitCode: result.status, stderr: result.stderr, stdout: result.stdout }, null, 2)}\n`,
    "utf8"
  );
  console.warn(`snapshot capture skipped: ${command} ${args.join(" ")} failed with exit code ${result.status}`);
  return false;
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
