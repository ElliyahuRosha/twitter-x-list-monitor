// run first: npm install image-video-watermark

const addWatermark = require('image-video-watermark').default;
const fs = require('fs');

const inputPath = '/root/Desktop/simple-agent/tweet-grabber-test/main/main-multiple-lists/watermarking/tweet_GadiTaub1_1995091099573162207.png';
const watermarkPath = '/root/Desktop/simple-agent/tweet-grabber-test/main/main-multiple-lists/watermarking/watermark555.png';

const baseOptions = {
      position: 'top-right',
      margin: 2,
      opacity: 0.3
      // watermarkScalePercentage: 4
    };

(async () => {
  try {
    for (let i = 1; i <= 9; i++) {
      const watermarkScalePercentage = 4 + parseFloat((i / 10).toFixed(1));
      // const watermarkScalePercentage = i;

      const options = {
        ...baseOptions,
        watermarkScalePercentage
      };

      const result = await addWatermark(inputPath, watermarkPath, options);
      const outputPath = `./output_watermarkScalePercentage_${watermarkScalePercentage}.jpg`;

      fs.writeFileSync(outputPath, result.buffer);
      console.log(`✅ Saved: ${outputPath}`);
    }

  } catch (error) {
    console.error('❌ Error adding watermark:', error);
  }
})();
