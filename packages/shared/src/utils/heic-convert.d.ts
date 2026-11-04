declare module 'heic-convert' {
  interface HeicConvertOptions {
    buffer: Uint8Array
    format: 'JPEG' | 'PNG'
    quality?: number
  }

  function convert(options: HeicConvertOptions): Promise<ArrayBuffer | Uint8Array | Buffer>
  export default convert
}
