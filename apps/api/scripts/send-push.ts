import { runPushSender } from "../src/push/sender.js";

const result = await runPushSender();
console.log(`push sender: ${result.sent} sent, ${result.skipped} skipped`);
