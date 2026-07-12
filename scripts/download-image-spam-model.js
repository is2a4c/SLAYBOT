require("module-alias/register");

const { preloadVisionModel } = require("@src/services/imageSpamClassifier");

preloadVisionModel()
  .then((model) => {
    console.log(`Image-spam model ready: ${model}`);
    process.exit(0);
  })
  .catch((error) => {
    console.error(`Failed to prepare image-spam model: ${error.message}`);
    process.exit(1);
  });
