"""Editable supporting-document exports for persisted ITR budget records."""
from collections import defaultdict
from decimal import Decimal, InvalidOperation
from io import BytesIO
import re


LAB_PURPOSE = (
    'The Robotics Club is homed in the Elevate Underground Lab, a space shared '
    'between Robotics and Cosplay Club. These items help maintain the space and '
    'continue creating a welcoming and clean space for students to work in.'
)


def populated_lab_rows(rows):
    """Exclude the UI-only trailing row while retaining incomplete saved drafts."""
    fields = ('name', 'link', 'unitPrice', 'quantity', 'vendor', 'notes')
    return [row for row in rows if any(str(row.get(field, '') or '').strip() for field in fields)]


def lab_export_filename(term_label):
    slug = re.sub(r'[^a-z0-9]+', '-', str(term_label).casefold()).strip('-') or 'budget-term'
    return f'{slug}-lab-items-supporting-document.docx'


def _money_subtotals(rows):
    totals = defaultdict(Decimal)
    for row in rows:
        try:
            amount = Decimal(str(row.get('totalCost', '')))
        except (InvalidOperation, ValueError):
            continue
        totals[str(row.get('currency', 'USD') or 'USD').upper()] += amount
    return totals


def lab_supporting_document(term, rows):
    """Build a DOCX from server-persisted Lab Items rows, entirely in memory."""
    try:
        from docx import Document
        from docx.oxml import OxmlElement
        from docx.oxml.ns import qn
        from docx.shared import Inches
    except ModuleNotFoundError as error:
        raise RuntimeError('The DOCX export dependency is unavailable.') from error

    rows = populated_lab_rows(rows)
    if not rows:
        raise ValueError('Add and save at least one Lab Items row before exporting.')

    def add_link(paragraph, url):
        # python-docx has no public hyperlink builder. This adds an ordinary
        # external relationship and visible link without fetching the URL.
        relation_id = paragraph.part.relate_to(url, 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink', is_external=True)
        hyperlink = OxmlElement('w:hyperlink'); hyperlink.set(qn('r:id'), relation_id)
        run = OxmlElement('w:r'); properties = OxmlElement('w:rPr')
        color = OxmlElement('w:color'); color.set(qn('w:val'), '0563C1')
        underline = OxmlElement('w:u'); underline.set(qn('w:val'), 'single')
        properties.append(color); properties.append(underline); run.append(properties)
        text = OxmlElement('w:t'); text.text = url; run.append(text)
        hyperlink.append(run); paragraph._p.append(hyperlink)

    document = Document()
    section = document.sections[0]
    section.top_margin = section.bottom_margin = Inches(0.7)
    section.left_margin = section.right_margin = Inches(0.7)
    document.add_heading('Lab Items Supporting Documentation', level=0)
    document.add_paragraph(f'Budget term: {term["label"]}')
    document.add_heading('Purpose', level=1)
    document.add_paragraph(LAB_PURPOSE)
    document.add_heading('Justification', level=1)
    document.add_paragraph('Add justification here.')
    document.add_heading('Images and supporting context', level=1)
    document.add_paragraph('Add images, captions, or supporting context here.')
    document.add_heading('Line items', level=1)
    table = document.add_table(rows=1, cols=8); table.style = 'Table Grid'
    headers = ('Line item', 'Category', 'Vendor', 'Link', 'Unit price', 'Quantity', 'Total cost', 'Description / notes')
    for cell, heading in zip(table.rows[0].cells, headers):
        cell.text = heading
    for row in rows:
        cells = table.add_row().cells
        values = (row.get('name', ''), 'Lab Consumables', row.get('vendor', ''), '',
                  row.get('unitPrice', '') or '', row.get('quantity', '') or '',
                  row.get('totalCost', '') or '', row.get('notes', ''))
        for cell, value in zip(cells, values):
            cell.text = str(value)
        if row.get('link'):
            add_link(cells[3].paragraphs[0], row['link'])
    document.add_heading('Calculated subtotals', level=1)
    for currency, total in sorted(_money_subtotals(rows).items()):
        document.add_paragraph(f'{currency} {total:.2f}')
    document.add_paragraph('Exported from the saved ITR Budget record. Edits made in this document do not change the budget table.', style='Caption')
    output = BytesIO(); document.save(output)
    return output.getvalue()
