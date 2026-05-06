import { createInterface } from "node:readline";

function rl() {
  return createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

export function input(prompt: string, defaultVal?: string): Promise<string> {
  const iface = rl();
  const hint = defaultVal ? ` (${defaultVal})` : "";
  return new Promise((resolve) => {
    iface.question(`${prompt}${hint}: `, (answer) => {
      iface.close();
      resolve(answer.trim() || defaultVal || "");
    });
  });
}

export function confirm(prompt: string): Promise<boolean> {
  const iface = rl();
  return new Promise((resolve) => {
    iface.question(`${prompt}: `, (answer) => {
      iface.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}
