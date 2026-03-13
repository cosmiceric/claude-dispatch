import { exec } from "child_process";

export function notify(title: string, message: string) {
  const escaped = message.replace(/"/g, '\\"').slice(0, 200);
  const script = `display notification "${escaped}" with title "${title}" sound name "Ping"`;
  exec(`osascript -e '${script}'`, () => {
    // fire and forget
  });
}
