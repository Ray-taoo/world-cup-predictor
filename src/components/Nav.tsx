import Link from "next/link";
import { BarChart3, CalendarDays, Database, GitBranch, Home, ListOrdered, RefreshCcw, Trophy } from "lucide-react";

const items = [
  { href: "/", label: "总览", icon: Home },
  { href: "/matches", label: "比赛", icon: CalendarDays },
  { href: "/bracket", label: "淘汰赛", icon: GitBranch },
  { href: "/groups", label: "小组赛", icon: ListOrdered },
  { href: "/review", label: "复盘", icon: RefreshCcw },
  { href: "/backtest", label: "回测", icon: BarChart3 },
  { href: "/sources", label: "来源", icon: Database }
];

export function Nav() {
  return (
    <nav className="topnav" aria-label="主导航">
      <Link href="/" className="brand">
        <span className="brand-mark" aria-hidden="true">
          <Trophy size={18} />
        </span>
        <span>世界杯预测</span>
      </Link>
      <div className="navlinks">
        {items.map((item) => (
          <Link key={item.href} href={item.href} className="navlink">
            <item.icon size={16} aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
