function range(count) {
  return new Array(count).fill(null).map((_, i) => i);
}

export default async function parseAlphas(georaster) {
  const geotiff = georaster._geotiff;
  const image = await geotiff.getImage();

  let { BitsPerSample, ExtraSamples, SampleFormat } = image.fileDirectory;
  if (!SampleFormat) SampleFormat = new Array(BitsPerSample.length).fill(1);

  const bands = range(BitsPerSample.length).map(i => {
    const sFormat = SampleFormat[i];
    const nbits = BitsPerSample[i];

    let int, min, range;
    if (sFormat === 1) {
      // unsigned integer data
      int = true;
      min = 0;
      const max = Math.pow(2, nbits) - 1;
      range = max - min;
    } else if (sFormat === 2) {
      // two's complement signed integer data
      min = -1 * Math.pow(2, nbits - 1);
      const max = Math.pow(2, nbits - 1) - 1;
      range = max - min;
    } else if (sFormat === 3) {
      // IEEE floating point data
    } else if (sFormat === 4) {
      // undefined data format
    }

    return [i, { int, min, range }];
  });
  const extra = ExtraSamples ? ExtraSamples.length : 0;
  const alphas = bands.slice(bands.length - extra);

  return Object.fromEntries(alphas);
}
