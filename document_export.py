"""Produce a small, valid Word document with Python's standard library."""
import io
import re
from xml.sax.saxutils import escape
from zipfile import ZIP_DEFLATED, ZipFile


def word_document(title, transcript):
    def paragraph(value, style=None):
        clean = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', value)
        prefix = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ''
        return f'<w:p>{prefix}<w:r><w:t xml:space="preserve">{escape(clean)}</w:t></w:r></w:p>'

    paragraphs = paragraph(title, 'Title') + paragraph('Transcripción', 'Heading1')
    paragraphs += ''.join(paragraph(line) for line in transcript.splitlines())
    document = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                '<w:body>' + paragraphs + '<w:sectPr/></w:body></w:document>')
    content_types = ('<?xml version="1.0" encoding="UTF-8"?>'
                     '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                     '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                     '<Default Extension="xml" ContentType="application/xml"/>'
                     '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
                     '</Types>')
    package_rels = ('<?xml version="1.0" encoding="UTF-8"?>'
                    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
                    '</Relationships>')
    buffer = io.BytesIO()
    with ZipFile(buffer, 'w', ZIP_DEFLATED) as archive:
        archive.writestr('[Content_Types].xml', content_types)
        archive.writestr('_rels/.rels', package_rels)
        archive.writestr('word/document.xml', document)
    return buffer.getvalue()
