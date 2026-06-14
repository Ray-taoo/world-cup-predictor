const teamZh: Record<string, string> = {
  Mexico: "墨西哥",
  "South Africa": "南非",
  "South Korea": "韩国",
  "Czech Republic": "捷克",
  Canada: "加拿大",
  "Bosnia & Herzegovina": "波黑",
  Qatar: "卡塔尔",
  Switzerland: "瑞士",
  Brazil: "巴西",
  Morocco: "摩洛哥",
  Haiti: "海地",
  Scotland: "苏格兰",
  USA: "美国",
  Paraguay: "巴拉圭",
  Australia: "澳大利亚",
  Turkey: "土耳其",
  Germany: "德国",
  "Curaçao": "库拉索",
  "Ivory Coast": "科特迪瓦",
  Ecuador: "厄瓜多尔",
  Netherlands: "荷兰",
  Japan: "日本",
  Sweden: "瑞典",
  Tunisia: "突尼斯",
  Belgium: "比利时",
  Egypt: "埃及",
  Iran: "伊朗",
  "New Zealand": "新西兰",
  Spain: "西班牙",
  "Cape Verde": "佛得角",
  "Saudi Arabia": "沙特阿拉伯",
  Uruguay: "乌拉圭",
  France: "法国",
  Senegal: "塞内加尔",
  Iraq: "伊拉克",
  Norway: "挪威",
  Argentina: "阿根廷",
  Algeria: "阿尔及利亚",
  Austria: "奥地利",
  Jordan: "约旦",
  Portugal: "葡萄牙",
  "DR Congo": "刚果（金）",
  Uzbekistan: "乌兹别克斯坦",
  Colombia: "哥伦比亚",
  England: "英格兰",
  Croatia: "克罗地亚",
  Italy: "意大利",
  Ghana: "加纳",
  Panama: "巴拿马"
};

const confedZh: Record<string, string> = {
  UEFA: "欧洲",
  CONMEBOL: "南美",
  CONCACAF: "中北美及加勒比",
  CAF: "非洲",
  AFC: "亚洲",
  OFC: "大洋洲",
  Unknown: "未知"
};

const venueZh: Record<string, string> = {
  "Mexico City": "墨西哥城",
  "Guadalajara (Zapopan)": "瓜达拉哈拉",
  "Monterrey (Guadalupe)": "蒙特雷",
  "Toronto": "多伦多",
  "Vancouver": "温哥华",
  "Los Angeles (Inglewood)": "洛杉矶",
  "New York/New Jersey (East Rutherford)": "纽约/新泽西",
  "Dallas (Arlington)": "达拉斯",
  "Kansas City": "堪萨斯城",
  "Boston (Foxborough)": "波士顿",
  "Atlanta": "亚特兰大",
  "Miami (Miami Gardens)": "迈阿密",
  "Houston": "休斯敦",
  "Philadelphia": "费城",
  "Seattle": "西雅图",
  "San Francisco Bay Area (Santa Clara)": "旧金山湾区"
};

export function teamName(name: string | undefined): string {
  if (!name) return "待定";
  return teamZh[name] ?? name;
}

export function canonicalTeamNameFromInput(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed in teamZh) return trimmed;
  const byChinese = Object.entries(teamZh).find(([, zh]) => zh === trimmed);
  return byChinese?.[0] ?? null;
}

export function teamPair(home: string, away: string): string {
  return `${teamName(home)} 对 ${teamName(away)}`;
}

export function confederationName(name: string): string {
  return confedZh[name] ?? name;
}

export function venueName(name: string): string {
  return venueZh[name] ?? name;
}

export function groupName(group: string): string {
  return `${group}组`;
}

export function roundName(round: string): string {
  const map: Record<string, string> = {
    R32: "32强",
    R16: "16强",
    QF: "8强",
    SF: "半决赛",
    Final: "决赛",
    Third: "三四名"
  };
  return map[round] ?? round;
}

export function bracketLabel(label: string): string {
  return label
    .replaceAll("Winner Group", "小组第1")
    .replaceAll("Runner-up Group", "小组第2")
    .replaceAll("Best 3rd", "最佳第3名")
    .replaceAll("Winner", "胜者")
    .replaceAll("Group", "小组");
}
