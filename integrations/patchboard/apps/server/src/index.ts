import { startBoardServer } from "./http-server.ts";

const running = await startBoardServer();
const shutdown = async () => {
  try {
    await running.close();
  } catch (error) {
    console.error("Patchboard backend shutdown failed", error);
    process.exitCode = 1;
  }
};
process.once("SIGINT", () => {
  void shutdown();
});
process.once("SIGTERM", () => {
  void shutdown();
});
