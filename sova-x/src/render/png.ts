import sharp from 'sharp';

export async function renderSvgToPngBuffer(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg, 'utf8'))
    .png()
    .toBuffer();
}
