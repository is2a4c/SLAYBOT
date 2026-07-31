const { IoIntelligenceClient } = require("../src/services/ai/IoIntelligenceClient");

async function main() {
  const client = new IoIntelligenceClient();
  if (!client.isConfigured()) {
    throw new Error("IO_INTELLIGENCE_API_KEY is not configured");
  }

  const result = await client.checkConfiguredModel();
  console.log(`Configured model: ${result.model}`);
  console.log(`Available: ${result.available ? "yes" : "no"}`);
  console.log(`Chat Completions: ${result.chatCompletions ? "yes" : "no"}`);
  console.log(`Image input: ${result.supportsImages ? "yes" : "no"}`);
  console.log(`Context window: ${result.contextWindow || "not reported"}`);

  if (!result.available || !result.chatCompletions) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`AI configuration check failed: ${error.message}`);
  process.exitCode = 1;
});
