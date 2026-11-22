export function transcriptFilename(title, extension) {
  const safe = (title || 'reunion').replace(/[^\p{L}\p{N} -]/gu, '').trim().slice(0, 70) || 'reunion';
  return safe + '-transcripcion.' + extension;
}

export async function transcriptFile(text, title, format) {
  if (!text.trim()) throw Error('La transcripción está vacía.');
  if (format === 'txt') return new Blob([text], { type: 'text/plain;charset=utf-8' });
  if (format === 'md') {
    const cleanTitle = title.replace(/[\r\n]+/g, ' ').trim();
    return new Blob(['# Transcripción · ' + cleanTitle + '\n\n' + text + '\n'], { type: 'text/markdown;charset=utf-8' });
  }
  if (format !== 'docx') throw Error('Formato de transcripción desconocido.');
  return wordFile(title, text);
}

const wordMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const crcTable = Uint32Array.from({length:256}, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc >>> 0;
});

function wordFile(title, text) {
  const paragraph = line => {
    const clean = line.replace(/[^\u0009\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu,'')
      .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
    return '<w:p><w:r><w:t xml:space="preserve">' + clean + '</w:t></w:r></w:p>';
  };
  const parts = {
    '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml':'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      [title,...text.split(/\r\n|\r|\n/)].map(paragraph).join('') + '<w:sectPr/></w:body></w:document>'
  };
  // ZIP STORE records. The central directory points to each local header.
  const encoder = new TextEncoder(), local = [], directory = [];
  let offset = 0, directoryBytes = 0;
  for (const [path, content] of Object.entries(parts)) {
    const name = encoder.encode(path), body = encoder.encode(content);
    const crc = (body.reduce((v,b) => crcTable[(v ^ b) & 255] ^ (v >>> 8), 0xffffffff) ^ 0xffffffff) >>> 0;
    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0,0x04034b50,true);
    header.setUint16(4,20,true);
    header.setUint16(12,33,true);
    header.setUint32(14,crc,true);
    header.setUint32(18,body.length,true);
    header.setUint32(22,body.length,true);
    header.setUint16(26,name.length,true);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0,0x02014b50,true);
    central.setUint16(4,20,true);
    new Uint8Array(central.buffer,6,26).set(new Uint8Array(header.buffer,4,26));
    central.setUint32(42,offset,true);
    local.push(header,name,body); directory.push(central,name);
    offset += 30 + name.length + body.length;
    directoryBytes += 46 + name.length;
  }
  const end = new DataView(new ArrayBuffer(22)), count = Object.keys(parts).length;
  end.setUint32(0,0x06054b50,true);
  end.setUint16(8,count,true); end.setUint16(10,count,true);
  end.setUint32(12,directoryBytes,true); end.setUint32(16,offset,true);
  return new Blob([...local,...directory,end], {type:wordMime});
}
