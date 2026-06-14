import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "src", "data", "generated-data.json");
const OPENFOOTBALL_BASE = "https://raw.githubusercontent.com/openfootball/worldcup/master";
const RESULTS_URL = "https://raw.githubusercontent.com/martj42/international_results/master/results.csv";

const CUP_URLS = {
  2006: `${OPENFOOTBALL_BASE}/2006--germany/cup.txt`,
  2010: `${OPENFOOTBALL_BASE}/2010--south-africa/cup.txt`,
  2014: `${OPENFOOTBALL_BASE}/2014--brazil/cup.txt`,
  2018: `${OPENFOOTBALL_BASE}/2018--russia/cup.txt`,
  2022: `${OPENFOOTBALL_BASE}/2022--qatar/cup.txt`,
  2026: `${OPENFOOTBALL_BASE}/2026--usa/cup.txt`
};

const CUP_STARTS = {
  2006: "2006-06-09",
  2010: "2010-06-11",
  2014: "2014-06-12",
  2018: "2018-06-14",
  2022: "2022-11-20"
};

const CHAMPIONS = {
  2006: "Italy",
  2010: "Spain",
  2014: "Germany",
  2018: "France",
  2022: "Argentina"
};

const CONFEDERATION = {
  Mexico: "CONCACAF",
  "South Africa": "CAF",
  "South Korea": "AFC",
  "Czech Republic": "UEFA",
  Canada: "CONCACAF",
  "Bosnia & Herzegovina": "UEFA",
  Qatar: "AFC",
  Switzerland: "UEFA",
  Brazil: "CONMEBOL",
  Morocco: "CAF",
  Haiti: "CONCACAF",
  Scotland: "UEFA",
  USA: "CONCACAF",
  Paraguay: "CONMEBOL",
  Australia: "AFC",
  Turkey: "UEFA",
  Germany: "UEFA",
  "Curaçao": "CONCACAF",
  "Ivory Coast": "CAF",
  Ecuador: "CONMEBOL",
  Netherlands: "UEFA",
  Japan: "AFC",
  Sweden: "UEFA",
  Tunisia: "CAF",
  Belgium: "UEFA",
  Egypt: "CAF",
  Iran: "AFC",
  "New Zealand": "OFC",
  Spain: "UEFA",
  "Cape Verde": "CAF",
  "Saudi Arabia": "AFC",
  Uruguay: "CONMEBOL",
  France: "UEFA",
  Senegal: "CAF",
  Iraq: "AFC",
  Norway: "UEFA",
  Argentina: "CONMEBOL",
  Algeria: "CAF",
  Austria: "UEFA",
  Jordan: "AFC",
  Portugal: "UEFA",
  "DR Congo": "CAF",
  Uzbekistan: "AFC",
  Colombia: "CONMEBOL",
  England: "UEFA",
  Croatia: "UEFA",
  Ghana: "CAF",
  Panama: "CONCACAF"
};

const NAME_ALIASES = new Map(
  Object.entries({
    "United States": "USA",
    "United States of America": "USA",
    "Korea Republic": "South Korea",
    "South Korea": "South Korea",
    "Czechia": "Czech Republic",
    "Czech Republic": "Czech Republic",
    "Türkiye": "Turkey",
    "Turkey": "Turkey",
    "IR Iran": "Iran",
    "Iran": "Iran",
    "Côte d'Ivoire": "Ivory Coast",
    "Ivory Coast": "Ivory Coast",
    "Congo DR": "DR Congo",
    "DR Congo": "DR Congo",
    "Cabo Verde": "Cape Verde",
    "Cape Verde": "Cape Verde",
    "Bosnia and Herzegovina": "Bosnia & Herzegovina",
    "Bosnia & Herzegovina": "Bosnia & Herzegovina",
    Curacao: "Curaçao",
    "Curaçao": "Curaçao"
  })
);

const months = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  June: 5,
  Jul: 6,
  July: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11
};

function canonicalTeam(name) {
  const trimmed = name.replace(/\s+/g, " ").trim();
  return NAME_ALIASES.get(trimmed) ?? trimmed;
}

async function fetchText(url) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { "user-agent": "codex-world-cup-predictor" } });
      if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
      }
      return response.text();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }
  throw lastError;
}

function parseCup(text, year) {
  const groups = [];
  const fixtures = [];
  const scoredMatches = [];
  let currentGroup = "";
  let currentDate = null;
  let matchNo = 1;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("=") || line.startsWith("####")) continue;

    const groupLine = line.match(/^Group\s+([A-L])\s+\|\s+(.+)$/);
    if (groupLine) {
      const teams = groupLine[2].split(/\s{2,}/).map(canonicalTeam);
      groups.push({ id: groupLine[1], teams });
      continue;
    }

    const groupHeader = line.match(/^▪\s+Group\s+([A-L])$/);
    if (groupHeader) {
      currentGroup = groupHeader[1];
      currentDate = null;
      continue;
    }

    const dateOnly = line.match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+([A-Z][a-z]+)\s+(\d{1,2})$/);
    if (dateOnly) {
      currentDate = {
        weekday: dateOnly[1],
        month: dateOnly[2],
        day: dateOnly[3]
      };
      continue;
    }

    const future = line.match(/^(\d{2}:\d{2})\s+(UTC[+-]\d+)\s+(.+?)\s+v\s+(.+?)\s+@\s+(.+)$/);
    if (future && currentGroup) {
      if (!currentDate) {
        throw new Error(`Fixture without current date in ${year}: ${line}`);
      }
      fixtures.push({
        id: `M${String(matchNo).padStart(3, "0")}`,
        matchNumber: matchNo,
        stage: "group",
        group: currentGroup,
        dateLabel: `${currentDate.weekday} ${currentDate.month} ${currentDate.day}, ${future[1]} ${future[2]}`,
        sortDate: isoFromParts(year, currentDate.month, currentDate.day, future[1], future[2]),
        home: canonicalTeam(future[3]),
        away: canonicalTeam(future[4]),
        venue: future[5].trim()
      });
      matchNo += 1;
      continue;
    }

    const scoredFuture = line.match(/^(\d{2}:\d{2})\s+(UTC[+-]\d+)\s+(.+?)\s+(\d+)-(\d+)(?:\s+\([^)]+\))?\s+(.+?)\s+@\s+(.+)$/);
    if (scoredFuture && currentGroup) {
      if (!currentDate) {
        throw new Error(`Scored fixture without current date in ${year}: ${line}`);
      }
      const home = canonicalTeam(scoredFuture[3]);
      const away = canonicalTeam(scoredFuture[6]);
      if (year === 2026) {
        fixtures.push({
          id: `M${String(matchNo).padStart(3, "0")}`,
          matchNumber: matchNo,
          stage: "group",
          group: currentGroup,
          dateLabel: `${currentDate.weekday} ${currentDate.month} ${currentDate.day}, ${scoredFuture[1]} ${scoredFuture[2]}`,
          sortDate: isoFromParts(year, currentDate.month, currentDate.day, scoredFuture[1], scoredFuture[2]),
          home,
          away,
          venue: scoredFuture[7].trim()
        });
        matchNo += 1;
      }
      scoredMatches.push({
        id: `${year}-${String(scoredMatches.length + 1).padStart(3, "0")}`,
        group: currentGroup || null,
        home,
        away,
        homeScore: Number(scoredFuture[4]),
        awayScore: Number(scoredFuture[5])
      });
      continue;
    }

    const scoreLine = stripDatePrefix(line);
    const scoredAfterTeams = scoreLine.match(/^(.+?)\s+v\s+(.+?)\s+(\d+)-(\d+)(?:\s+\([^)]+\))?(?:\s+@.*)?$/);
    const scoredBetweenTeams = scoreLine.match(/^(.+?)\s+(\d+)-(\d+)(?:\s+\([^)]+\))?(?:\s+a\.e\.t\.)?\s+(.+?)(?:\s+@.*)?$/);
    if (scoredAfterTeams) {
      scoredMatches.push({
        id: `${year}-${String(scoredMatches.length + 1).padStart(3, "0")}`,
        group: currentGroup || null,
        home: canonicalTeam(scoredAfterTeams[1]),
        away: canonicalTeam(scoredAfterTeams[2]),
        homeScore: Number(scoredAfterTeams[3]),
        awayScore: Number(scoredAfterTeams[4])
      });
    } else if (scoredBetweenTeams) {
      scoredMatches.push({
        id: `${year}-${String(scoredMatches.length + 1).padStart(3, "0")}`,
        group: currentGroup || null,
        home: canonicalTeam(scoredBetweenTeams[1]),
        away: canonicalTeam(scoredBetweenTeams[4]),
        homeScore: Number(scoredBetweenTeams[2]),
        awayScore: Number(scoredBetweenTeams[3])
      });
    }
  }

  return { groups, fixtures, scoredMatches };
}

function stripDatePrefix(line) {
  return line
    .replace(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+[A-Z][a-z]+\s+\d{1,2}\s+(?:\d{2}:\d{2}\s+)?/, "")
    .replace(/^\d{2}:\d{2}\s+(?:UTC[+-]\d+\s+)?/, "")
    .trim();
}

function isoFromParts(year, monthName, day, time, tz) {
  const [hour, minute] = time.split(":").map(Number);
  const offset = Number(tz.replace("UTC", ""));
  const utcMs = Date.UTC(year, months[monthName], Number(day), hour - offset, minute);
  return new Date(utcMs).toISOString();
}

function parseCsvLine(line) {
  const out = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"' && quoted && line[i + 1] === '"') {
      field += '"';
      i += 1;
    } else if (c === '"') {
      quoted = !quoted;
    } else if (c === "," && !quoted) {
      out.push(field);
      field = "";
    } else {
      field += c;
    }
  }
  out.push(field);
  return out;
}

function parseResultsCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const header = parseCsvLine(lines.shift());
  const idx = Object.fromEntries(header.map((name, i) => [name, i]));
  return lines
    .map((line) => {
      const cols = parseCsvLine(line);
      return {
        date: cols[idx.date],
        home: canonicalTeam(cols[idx.home_team]),
        away: canonicalTeam(cols[idx.away_team]),
        homeScore: Number(cols[idx.home_score]),
        awayScore: Number(cols[idx.away_score]),
        tournament: cols[idx.tournament],
        neutral: cols[idx.neutral] === "TRUE"
      };
    })
    .filter((m) => Number.isFinite(m.homeScore) && Number.isFinite(m.awayScore));
}

function kFactor(tournament) {
  if (/FIFA World Cup$/i.test(tournament)) return 60;
  if (/qualification|qualifying/i.test(tournament)) return 35;
  if (/UEFA Euro|Copa América|African Cup|Asian Cup|Gold Cup|Nations League/i.test(tournament)) return 40;
  if (/Friendly/i.test(tournament)) return 12;
  return 24;
}

function buildElo(results, untilDate = "9999-12-31") {
  const ratings = new Map();
  const matches = results
    .filter((m) => m.date < untilDate)
    .sort((a, b) => a.date.localeCompare(b.date));

  for (const match of matches) {
    const home = match.home;
    const away = match.away;
    const homeRating = ratings.get(home) ?? 1500;
    const awayRating = ratings.get(away) ?? 1500;
    const homeAdvantage = match.neutral ? 0 : 65;
    const expectedHome = 1 / (1 + 10 ** ((awayRating - homeRating - homeAdvantage) / 400));
    const actualHome = match.homeScore > match.awayScore ? 1 : match.homeScore === match.awayScore ? 0.5 : 0;
    const margin = Math.max(1, Math.abs(match.homeScore - match.awayScore));
    const multiplier = Math.log(margin + 1) * 1.25;
    const change = kFactor(match.tournament) * multiplier * (actualHome - expectedHome);
    ratings.set(home, homeRating + change);
    ratings.set(away, awayRating - change);
  }

  return ratings;
}

function recentForm(results, team) {
  const matches = results
    .filter((m) => m.home === team || m.away === team)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10);
  let wins = 0;
  let draws = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;
  for (const match of matches) {
    const isHome = match.home === team;
    const gf = isHome ? match.homeScore : match.awayScore;
    const ga = isHome ? match.awayScore : match.homeScore;
    goalsFor += gf;
    goalsAgainst += ga;
    if (gf > ga) wins += 1;
    if (gf === ga) draws += 1;
  }
  return {
    matches: matches.length,
    wins,
    draws,
    losses: matches.length - wins - draws,
    goalsFor,
    goalsAgainst
  };
}

function poisson(lambda, k) {
  let fact = 1;
  for (let i = 2; i <= k; i += 1) fact *= i;
  return (Math.exp(-lambda) * lambda ** k) / fact;
}

function matchProbabilities(homeElo, awayElo, neutral = true, temperature = 1) {
  const diff = (homeElo + (neutral ? 0 : 55) - awayElo) / 400;
  const homeGoals = clamp(1.28 * Math.exp(diff * 0.72), 0.18, 3.7);
  const awayGoals = clamp(1.18 * Math.exp(-diff * 0.72), 0.18, 3.7);
  let home = 0;
  let draw = 0;
  let away = 0;
  for (let h = 0; h <= 8; h += 1) {
    for (let a = 0; a <= 8; a += 1) {
      let p = poisson(homeGoals, h) * poisson(awayGoals, a);
      if ((h === 0 && a === 0) || (h === 1 && a === 1)) p *= 1.08;
      if (h > a) home += p;
      else if (h === a) draw += p;
      else away += p;
    }
  }
  const total = home + draw + away;
  const calibrated = calibrateProbabilitySet(
    {
      home: home / total,
      draw: draw / total,
      away: away / total
    },
    temperature
  );
  return {
    ...calibrated,
    xgHome: homeGoals,
    xgAway: awayGoals
  };
}

function calibrateProbabilitySet(probs, temperature) {
  if (Math.abs(temperature - 1) < 0.001) return probs;
  const adjusted = {
    home: probs.home ** (1 / temperature),
    draw: probs.draw ** (1 / temperature),
    away: probs.away ** (1 / temperature)
  };
  const total = adjusted.home + adjusted.draw + adjusted.away;
  return {
    home: adjusted.home / total,
    draw: adjusted.draw / total,
    away: adjusted.away / total
  };
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function outcome(match) {
  if (match.homeScore > match.awayScore) return "home";
  if (match.homeScore < match.awayScore) return "away";
  return "draw";
}

function backtestMatches(matches, ratings, temperature = 1) {
  let correct = 0;
  let brier = 0;
  let logLoss = 0;
  let count = 0;
  let high55 = 0;
  let high55Correct = 0;
  let high60 = 0;
  let high60Correct = 0;
  let high70 = 0;
  let high70Correct = 0;
  let overconfident = 0;
  let overconfidentWrong = 0;
  for (const match of matches) {
    const homeElo = ratings.get(match.home) ?? 1500;
    const awayElo = ratings.get(match.away) ?? 1500;
    const probs = matchProbabilities(homeElo, awayElo, true, temperature);
    const actual = outcome(match);
    const entries = Object.entries({ home: probs.home, draw: probs.draw, away: probs.away }).sort((a, b) => b[1] - a[1]);
    const predicted = entries[0][0];
    const topProbability = entries[0][1];
    const y = { home: actual === "home" ? 1 : 0, draw: actual === "draw" ? 1 : 0, away: actual === "away" ? 1 : 0 };
    const isCorrect = predicted === actual;
    correct += isCorrect ? 1 : 0;
    if (topProbability >= 0.55) {
      high55 += 1;
      high55Correct += isCorrect ? 1 : 0;
    }
    if (topProbability >= 0.6) {
      high60 += 1;
      high60Correct += isCorrect ? 1 : 0;
    }
    if (topProbability >= 0.7) {
      high70 += 1;
      high70Correct += isCorrect ? 1 : 0;
      overconfident += 1;
      overconfidentWrong += isCorrect ? 0 : 1;
    }
    brier += ((probs.home - y.home) ** 2 + (probs.draw - y.draw) ** 2 + (probs.away - y.away) ** 2) / 3;
    logLoss += -Math.log(Math.max(0.001, probs[actual]));
    count += 1;
  }
  return {
    matches: count,
    accuracy: count ? correct / count : 0,
    brier: count ? brier / count : 0,
    logLoss: count ? logLoss / count : 0,
    highConfidence55Matches: high55,
    highConfidence55Accuracy: high55 ? high55Correct / high55 : null,
    highConfidence60Matches: high60,
    highConfidence60Accuracy: high60 ? high60Correct / high60 : null,
    highConfidence70Matches: high70,
    highConfidence70Accuracy: high70 ? high70Correct / high70 : null,
    overconfidentMatches: overconfident,
    overconfidentWrong
  };
}

function weightedBacktest(cups, temperature) {
  let matches = 0;
  let correct = 0;
  let brier = 0;
  let logLoss = 0;
  for (const item of cups) {
    const metrics = backtestMatches(item.cup.scoredMatches, item.ratings, temperature);
    matches += metrics.matches;
    correct += metrics.accuracy * metrics.matches;
    brier += metrics.brier * metrics.matches;
    logLoss += metrics.logLoss * metrics.matches;
  }
  return {
    matches,
    accuracy: matches ? correct / matches : 0,
    brier: matches ? brier / matches : 0,
    logLoss: matches ? logLoss / matches : 0
  };
}

function optimizeTemperature(cups) {
  let best = { temperature: 1, ...weightedBacktest(cups, 1) };
  for (let temp = 0.75; temp <= 1.4001; temp += 0.05) {
    const rounded = Number(temp.toFixed(2));
    const metrics = weightedBacktest(cups, rounded);
    if (metrics.logLoss < best.logLoss || (metrics.logLoss === best.logLoss && metrics.brier < best.brier)) {
      best = { temperature: rounded, ...metrics };
    }
  }
  return best;
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function sampleOutcome(probs, random) {
  const r = random();
  if (r < probs.home) return "home";
  if (r < probs.home + probs.draw) return "draw";
  return "away";
}

function rankStandings(rows) {
  return [...rows].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
    if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
    return b.elo - a.elo;
  });
}

function simulateClassicCup(cup, ratings, seed, temperature = 1) {
  const random = seededRandom(seed);
  const standings = new Map();
  for (const group of cup.groups) {
    standings.set(
      group.id,
      group.teams.map((team) => ({
        team,
        points: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDifference: 0,
        elo: ratings.get(team) ?? 1500
      }))
    );
  }

  for (const match of cup.scoredMatches.filter((m) => m.group)) {
    const rows = standings.get(match.group);
    if (!rows) continue;
    const home = rows.find((row) => row.team === match.home);
    const away = rows.find((row) => row.team === match.away);
    if (!home || !away) continue;
    const probs = matchProbabilities(home.elo, away.elo, true, temperature);
    const result = sampleOutcome(probs, random);
    let hg = 1;
    let ag = 1;
    if (result === "home") {
      hg = 2;
      ag = 0;
      home.points += 3;
    } else if (result === "away") {
      hg = 0;
      ag = 2;
      away.points += 3;
    } else {
      home.points += 1;
      away.points += 1;
    }
    home.goalsFor += hg;
    home.goalsAgainst += ag;
    away.goalsFor += ag;
    away.goalsAgainst += hg;
    home.goalDifference = home.goalsFor - home.goalsAgainst;
    away.goalDifference = away.goalsFor - away.goalsAgainst;
  }

  const qualified = {};
  for (const group of cup.groups) {
    const ranked = rankStandings(standings.get(group.id));
    qualified[`${group.id}1`] = ranked[0].team;
    qualified[`${group.id}2`] = ranked[1].team;
  }

  let bracket = [
    [qualified.A1, qualified.B2],
    [qualified.C1, qualified.D2],
    [qualified.E1, qualified.F2],
    [qualified.G1, qualified.H2],
    [qualified.B1, qualified.A2],
    [qualified.D1, qualified.C2],
    [qualified.F1, qualified.E2],
    [qualified.H1, qualified.G2]
  ].filter(([a, b]) => a && b);

  while (bracket.length > 1 || bracket[0]?.length === 2) {
    const winners = bracket.map(([a, b]) => knockoutWinner(a, b, ratings, random, temperature));
    bracket = [];
    for (let i = 0; i < winners.length; i += 2) {
      if (winners[i + 1]) bracket.push([winners[i], winners[i + 1]]);
      else return winners[i];
    }
  }
  return bracket[0]?.[0] ?? "";
}

function knockoutWinner(a, b, ratings, random, temperature = 1) {
  const probs = matchProbabilities(ratings.get(a) ?? 1500, ratings.get(b) ?? 1500, true, temperature);
  const noDrawHome = probs.home + probs.draw * ((ratings.get(a) ?? 1500) / ((ratings.get(a) ?? 1500) + (ratings.get(b) ?? 1500)));
  return random() < noDrawHome ? a : b;
}

function championProbability(cup, ratings, champion, year, temperature = 1) {
  const sims = 1500;
  let wins = 0;
  for (let i = 0; i < sims; i += 1) {
    if (simulateClassicCup(cup, ratings, year * 10000 + i, temperature) === champion) wins += 1;
  }
  return wins / sims;
}

async function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const [cup2026Text, resultsText] = await Promise.all([fetchText(CUP_URLS[2026]), fetchText(RESULTS_URL)]);
  const cup2026 = parseCup(cup2026Text, 2026);
  const results = parseResultsCsv(resultsText);
  const latestElo = buildElo(results);
  const teams = cup2026.groups.flatMap((group) =>
    group.teams.map((team) => ({
      id: team.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
      name: team,
      group: group.id,
      confederation: CONFEDERATION[team] ?? "Unknown",
      isHost: ["Mexico", "Canada", "USA"].includes(team),
      elo: Math.round(latestElo.get(team) ?? 1500),
      recentForm: recentForm(results, team),
      fifaRank: null,
      marketValueEurM: null
    }))
  );

  const historicalCups = [];
  for (const year of [2006, 2010, 2014, 2018, 2022]) {
    const cupText = await fetchText(CUP_URLS[year]);
    const cup = parseCup(cupText, year);
    const ratings = buildElo(results, CUP_STARTS[year]);
    historicalCups.push({ year, cup, ratings });
  }
  const calibrationSearch = optimizeTemperature(historicalCups);
  const calibration = {
    modelTemperature: calibrationSearch.temperature,
    defaultMarketWeight: 0.65,
    optimizedMarketWeight: null,
    note: "已用 2006-2022 五届世界杯回测做模型概率温度校准；暂未导入可靠历史盘口，因此盘口融合权重先用默认值。"
  };
  const backtests = [];
  for (const { year, cup, ratings } of historicalCups) {
    const rawMetrics = backtestMatches(cup.scoredMatches, ratings, 1);
    const matchMetrics = backtestMatches(cup.scoredMatches, ratings, calibration.modelTemperature);
    const champProb = championProbability(cup, ratings, CHAMPIONS[year], year, calibration.modelTemperature);
    backtests.push({
      year,
      champion: CHAMPIONS[year],
      actualChampionPreTournamentProbability: champProb,
      rawAccuracy: rawMetrics.accuracy,
      rawBrier: rawMetrics.brier,
      rawLogLoss: rawMetrics.logLoss,
      ...matchMetrics
    });
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    sources: [
      {
        name: "openfootball/worldcup 2026 schedule",
        url: CUP_URLS[2026],
        fetchedAt: new Date().toISOString(),
        usage: "2026 groups and fixtures"
      },
      {
        name: "martj42 international_results",
        url: RESULTS_URL,
        fetchedAt: new Date().toISOString(),
        usage: "Elo ratings and recent form"
      },
      {
        name: "openfootball/worldcup historical cups",
        url: "https://github.com/openfootball/worldcup",
        fetchedAt: new Date().toISOString(),
        usage: "2006-2022 backtest fixtures and results"
      }
    ],
    groups: cup2026.groups,
    teams,
    fixtures: cup2026.fixtures,
    calibration,
    backtests
  };

  fs.writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Wrote ${path.relative(ROOT, OUT)} with ${teams.length} teams and ${cup2026.fixtures.length} fixtures.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
