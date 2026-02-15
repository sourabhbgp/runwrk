import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";

const CONFIG_PATH = join(process.cwd(), ".myteam", "twitter-config.json");

export type TwitterConfig = {
  topics: string[];
  keywords: string[];
  watchAccounts: string[];
  limits: {
    maxLikesPerSession: number;
    maxRepliesPerSession: number;
    maxPostsPerDay: number;
    delayBetweenActions: [number, number];
  };
};

const DEFAULT_CONFIG: TwitterConfig = {
  topics: [],
  keywords: [],
  watchAccounts: [],
  limits: {
    maxLikesPerSession: 10,
    maxRepliesPerSession: 5,
    maxPostsPerDay: 3,
    delayBetweenActions: [2000, 5000],
  },
};

function ensureDir() {
  const dir = dirname(CONFIG_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function readConfig(): TwitterConfig {
  if (!existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG };
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function writeConfig(config: TwitterConfig): void {
  ensureDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

export function getDelay(config?: TwitterConfig): number {
  const [min, max] = (config ?? readConfig()).limits.delayBetweenActions;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
