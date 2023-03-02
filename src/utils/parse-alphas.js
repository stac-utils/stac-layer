import range from "./range.js";

export default async function parseAlphas(georaster) {
  const geotiff = georaster._geotiff;
  const image = await geotiff.getImage();

  const { BitsPerSample, ExtraSamples, SampleFormat } = image.fileDirectory;
  if (!SampleFormat) SampleFormat = new Array(BitsPerSample.length).fill(1);

  const bands = range(BitsPerSample.length).map(i => {
    const sampleFormat = SampleFormat[i];
    const nbits = BitsPerSample[i];

    let int, min, range;
    if (sampleFormat === 1) {
      // unsigned integer data
      int = true;
      min = 0;
      const max = Math.pow(2, nbits) - 1;
      range = max - min;
    } else if (sampleFormat === 2) {
      // two's complement signed integer data
      min = -1 * Math.pow(2, nbits - 1);
      const max = Math.pow(2, nbits - 1) - 1;
      range = max - min;
    } else if (sampleFormat === 3) {
      // IEEE floating point data
    } else if (SampleFormat === 4) {
      // undefined data format
    }

    return [i, { int, min, range }];
  });
  log(2, "bands in parseAlphas:", bands, image.fileDirectory);
  const extra = ExtraSamples ? ExtraSamples.length : 0;
  const alphas = bands.slice(bands.length - extra);

  return Object.fromEntries(alphas);
}
