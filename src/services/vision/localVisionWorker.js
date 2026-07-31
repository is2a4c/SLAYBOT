const os = require("os");
const path = require("path");
const { parentPort, workerData } = require("worker_threads");

/**
 * The local vision model, kept off the main thread.
 *
 * Generation is a token-by-token loop with tensor work between every step. Run
 * in the bot's own thread it stalls the event loop for as long as the inference
 * takes, which on a CPU-only host is long enough that Discord gives up on every
 * interaction in the meantime — the bot appears dead until the image is done.
 */

let runtimePromise;

async function getRuntime() {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const { env, AutoProcessor, AutoModelForImageTextToText, RawImage } = await import("@huggingface/transformers");
      env.cacheDir = workerData.cacheDir || path.join(process.cwd(), ".cache", "image-spam");

      const availableThreads = os.availableParallelism?.() || os.cpus().length;
      const requested = Number.parseInt(workerData.threads, 10);
      const inferenceThreads =
        Number.isInteger(requested) && requested > 0
          ? Math.min(requested, availableThreads)
          : Math.max(1, Math.floor(availableThreads / 2));

      const [processor, model] = await Promise.all([
        AutoProcessor.from_pretrained(workerData.modelId),
        AutoModelForImageTextToText.from_pretrained(workerData.modelId, {
          dtype: workerData.dtype,
          device: "cpu",
          session_options: { intraOpNumThreads: inferenceThreads, interOpNumThreads: 1 },
        }),
      ]);

      return { processor, model, RawImage, inferenceThreads };
    })().catch((error) => {
      runtimePromise = undefined;
      throw error;
    });
  }

  return runtimePromise;
}

/**
 * @param {{buffer: Buffer, prompt: string, split: boolean}} job
 * @returns {Promise<string>}
 */
async function describe({ buffer, prompt, split }) {
  const runtime = await getRuntime();
  const messages = [{ role: "user", content: [{ type: "image" }, { type: "text", text: prompt }] }];
  const formatted = runtime.processor.tokenizer.apply_chat_template(messages, {
    add_generation_prompt: true,
    tokenize: false,
  });

  const image = await runtime.RawImage.fromBlob(new Blob([buffer], { type: "image/jpeg" }));
  const inputs = await runtime.processor(formatted, image, { do_image_splitting: split });
  const output = await runtime.model.generate({ ...inputs, max_new_tokens: 8, do_sample: false });

  return runtime.processor.tokenizer.batch_decode(output, { skip_special_tokens: true })[0] || "";
}

parentPort.on("message", async (job) => {
  if (job?.type === "preload") {
    try {
      const runtime = await getRuntime();
      parentPort.postMessage({ id: job.id, text: String(runtime.inferenceThreads) });
    } catch (error) {
      parentPort.postMessage({ id: job.id, error: error.message });
    }
    return;
  }

  try {
    parentPort.postMessage({ id: job.id, text: await describe(job) });
  } catch (error) {
    parentPort.postMessage({ id: job.id, error: error.message });
  }
});
