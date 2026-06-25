import * as vscode from "vscode";
import * as http from "http";

let server: http.Server | undefined;
const PORT = 3131;

export function activate(context: vscode.ExtensionContext) {
  startCompanionServer();
  vscode.window.showInformationMessage("ETL Jira Companion is active.");

  context.subscriptions.push({
    dispose: () => server?.close(),
  });
}

function startCompanionServer() {
  server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/confirm") {
      res.writeHead(404);
      res.end();
      return;
    }

    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const preview = JSON.parse(body);
        const decision = await showPreviewPopup(preview);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ decision }));
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ decision: "no" }));
      }
    });
  });

  server.listen(PORT, "127.0.0.1", () => {
    console.log(`ETL Jira companion listening on port ${PORT}`);
  });
}

async function showPreviewPopup(preview: {
  index: number;
  total: number;
  title: string;
  priority: string;
  pipeline: string;
  error_time: string;
  occurrences: number;
  error_msg: string;
  resolution: string[];
}): Promise<"yes" | "no" | "stop"> {
  const resolutionText = preview.resolution
    .slice(0, 3)
    .map((s, i) => `${i + 1}. ${s}`)
    .join("\n");

  const detail =
    `Pipeline : ${preview.pipeline}\n` +
    `Time     : ${preview.error_time}\n` +
    `Occurs   : ${preview.occurrences}x\n` +
    `Priority : ${preview.priority}\n\n` +
    `Error:\n${preview.error_msg}\n\n` +
    `Resolution (preview):\n${resolutionText}`;

  const pick = await vscode.window.showInformationMessage(
    `[${preview.index}/${preview.total}] ${preview.title}`,
    { modal: true, detail },
    "Create Ticket",
    "Skip",
    "Stop All"
  );

  if (pick === "Create Ticket") return "yes";
  if (pick === "Stop All") return "stop";
  return "no";
}

export function deactivate() {
  server?.close();
}
