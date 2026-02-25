// Terminal formatting helpers — zero dependencies

const esc = (code: string) => `\x1b[${code}m`;
const wrap = (code: string, reset: string) => (s: string) =>
  `${esc(code)}${s}${esc(reset)}`;

export const bold = wrap("1", "22");
export const dim = wrap("2", "22");
export const green = wrap("32", "39");
export const red = wrap("31", "39");
export const cyan = wrap("36", "39");
export const yellow = wrap("33", "39");

export function banner() {
  console.log(
    `\n${bold(cyan("runwrk"))} ${dim("— AI marketing team for developers")}\n`
  );
}

export function divider() {
  console.log(dim("─".repeat(50)));
}

export function success(msg: string) {
  console.log(`${green("✓")} ${msg}`);
}

export function error(msg: string) {
  console.error(`${red("✗")} ${msg}`);
}

export function warn(msg: string) {
  console.error(`${yellow("⚠")} ${msg}`);
}

export function info(msg: string) {
  console.log(`${cyan("→")} ${msg}`);
}

const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function spinner(msg: string) {
  let i = 0;
  const id = setInterval(() => {
    process.stdout.write(`\r${cyan(frames[i++ % frames.length])} ${msg}`);
  }, 80);
  return {
    stop(final?: string) {
      clearInterval(id);
      process.stdout.write(`\r${" ".repeat(msg.length + 4)}\r`);
      if (final) console.log(final);
    },
  };
}

export function ask(question: string): string | null {
  return prompt(`${cyan("?")} ${question}`);
}
