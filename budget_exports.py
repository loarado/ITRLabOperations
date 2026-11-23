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
PROJECT_CATEGORY_ORDER = (
    ('raw-material', 'Raw Material'),
    ('mechanism-components', 'Mechanism Components'),
    ('primitive-electrical-components', 'Primitive Electrical Components'),
    ('motion-electrical-components', 'Motion Electrical Components'),
    ('computing-and-sensing-components', 'Computing and Sensing Components'),
)


def populated_lab_rows(rows):
    """Exclude the UI-only trailing row while retaining incomplete saved drafts."""
    fields = ('name', 'link', 'unitPrice', 'quantity', 'vendor', 'notes')
    return [row for row in rows if any(str(row.get(field, '') or '').strip() for field in fields)]


def lab_export_filename(term_label):
    slug = re.sub(r'[^a-z0-9]+', '-', str(term_label).casefold()).strip('-') or 'budget-term'
    return f'{slug}-lab-items-supporting-document.docx'


def populated_event_rows(rows):
    return [row for row in rows if str(row.get('name', '') or '').strip()]


def event_export_filename(term_label):
    slug = re.sub(r'[^a-z0-9]+', '-', str(term_label).casefold()).strip('-') or 'budget-term'
    return f'{slug}-events-and-programming-supporting-document.docx'


def project_export_filename(term_label, project_name):
    term_slug = re.sub(r'[^a-z0-9]+', '-', str(term_label).casefold()).strip('-') or 'budget-term'
    project_slug = re.sub(r'[^a-z0-9]+', '-', str(project_name).casefold()).strip('-') or 'project'
    return f'{term_slug}-{project_slug}-supporting-document.docx'


def project_export_rows(rows, project_name):
    name = str(project_name or '').strip()
    return [row for row in rows if str(row.get('projectName', '') or '').strip() == name]


def project_rows_by_category(rows):
    groups = []
    remaining = list(rows)
    for category, label in PROJECT_CATEGORY_ORDER:
        matches = [row for row in remaining if row.get('category') == category]
        if matches:
            groups.append((label, matches))
            remaining = [row for row in remaining if row.get('category') != category]
    if remaining:
        groups.append(('Category needs review', remaining))
    return groups


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
        from docx.shared import Inches, Pt, RGBColor
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
        color = OxmlElement('w:color'); color.set(qn('w:val'), 'ED1C24')
        underline = OxmlElement('w:u'); underline.set(qn('w:val'), 'single')
        size = OxmlElement('w:sz'); size.set(qn('w:val'), '20')
        complex_size = OxmlElement('w:szCs'); complex_size.set(qn('w:val'), '20')
        properties.append(color); properties.append(underline); properties.append(size); properties.append(complex_size); run.append(properties)
        text = OxmlElement('w:t'); text.text = url; run.append(text)
        hyperlink.append(run); paragraph._p.append(hyperlink)

    def style_heading(paragraph, title=False):
        for run in paragraph.runs:
            run.bold = True
            run.font.color.rgb = RGBColor(0xED, 0x1C, 0x24)
        if title:
            properties = paragraph._p.get_or_add_pPr()
            borders = properties.find(qn('w:pBdr'))
            if borders is None:
                borders = OxmlElement('w:pBdr'); properties.append(borders)
            bottom = borders.find(qn('w:bottom'))
            if bottom is None:
                bottom = OxmlElement('w:bottom'); borders.append(bottom)
            bottom.set(qn('w:val'), 'single'); bottom.set(qn('w:sz'), '10')
            bottom.set(qn('w:space'), '1'); bottom.set(qn('w:color'), 'ED1C24')

    def set_table_font(cell, heading=False):
        for paragraph in cell.paragraphs:
            for run in paragraph.runs:
                run.font.size = Pt(10)
                if heading:
                    run.bold = True
                    run.font.color.rgb = RGBColor(0xED, 0x1C, 0x24)

    document = Document()
    section = document.sections[0]
    section.top_margin = section.bottom_margin = Inches(0.7)
    section.left_margin = section.right_margin = Inches(0.7)
    title = document.add_heading('Lab Items Supporting Documentation', level=0); style_heading(title, title=True)
    document.add_paragraph(f'Budget term: {term["label"]}')
    heading = document.add_heading('Purpose', level=1); style_heading(heading)
    document.add_paragraph(LAB_PURPOSE)
    heading = document.add_heading('Justification', level=1); style_heading(heading)
    document.add_paragraph('Add justification here.')
    heading = document.add_heading('Images and supporting context', level=1); style_heading(heading)
    document.add_paragraph('Add images, captions, or supporting context here.')
    heading = document.add_heading('Line items', level=1); style_heading(heading)
    table = document.add_table(rows=1, cols=8); table.style = 'Table Grid'
    headers = ('Line item', 'Category', 'Vendor', 'Link', 'Unit price', 'Quantity', 'Total cost', 'Description / notes')
    for cell, heading in zip(table.rows[0].cells, headers):
        cell.text = heading; set_table_font(cell, heading=True)
    for row in rows:
        cells = table.add_row().cells
        values = (row.get('name', ''), 'Lab Consumables', row.get('vendor', ''), '',
                  row.get('unitPrice', '') or '', row.get('quantity', '') or '',
                  row.get('totalCost', '') or '', row.get('notes', ''))
        for cell, value in zip(cells, values):
            cell.text = str(value); set_table_font(cell)
        if row.get('link'):
            add_link(cells[3].paragraphs[0], row['link'])
    heading = document.add_heading('Calculated subtotals', level=1); style_heading(heading)
    for currency, total in sorted(_money_subtotals(rows).items()):
        document.add_paragraph(f'{currency} {total:.2f}')
    output = BytesIO(); document.save(output)
    return output.getvalue()


def event_supporting_document(term, rows):
    """Build an editable DOCX from saved Events and Programming rows."""
    try:
        from docx import Document
        from docx.oxml import OxmlElement
        from docx.oxml.ns import qn
        from docx.shared import Inches, Pt, RGBColor
    except ModuleNotFoundError as error:
        raise RuntimeError('The DOCX export dependency is unavailable.') from error

    rows = populated_event_rows(rows)
    if not rows:
        raise ValueError('Save at least one Events and Programming row before exporting.')

    def style_heading(paragraph, title=False):
        for run in paragraph.runs:
            run.bold = True
            run.font.color.rgb = RGBColor(0xED, 0x1C, 0x24)
        if title:
            properties = paragraph._p.get_or_add_pPr()
            borders = properties.find(qn('w:pBdr'))
            if borders is None:
                borders = OxmlElement('w:pBdr'); properties.append(borders)
            bottom = borders.find(qn('w:bottom'))
            if bottom is None:
                bottom = OxmlElement('w:bottom'); borders.append(bottom)
            bottom.set(qn('w:val'), 'single'); bottom.set(qn('w:sz'), '10')
            bottom.set(qn('w:space'), '1'); bottom.set(qn('w:color'), 'ED1C24')

    def set_table_font(cell, heading=False):
        for paragraph in cell.paragraphs:
            for run in paragraph.runs:
                run.font.size = Pt(10)
                if heading:
                    run.bold = True
                    run.font.color.rgb = RGBColor(0xED, 0x1C, 0x24)

    document = Document()
    section = document.sections[0]
    section.top_margin = section.bottom_margin = Inches(0.7)
    section.left_margin = section.right_margin = Inches(0.7)
    title = document.add_heading('Events and Programming Supporting Documentation', level=0); style_heading(title, title=True)
    document.add_paragraph(f'Budget term: {term["label"]}')
    heading = document.add_heading('Events Description', level=1); style_heading(heading)
    document.add_paragraph('ITR is hosting many events in the Spring/Fall 20XX semester, including professional development initiatives, classes, and speaker events. The professional development sessions will be led by an executive member of ITR, with one collaboration planned with the career services department. Classes will be led by members of ITR. The speaker events will bring ITR alumni, associates of ITR members, and industry professionals to speak on robotics and computing topics. All events are open to anyone and will be included on 312.')
    heading = document.add_heading('Cost reasoning', level=1); style_heading(heading)
    document.add_paragraph('Funding for these events will provide catering, speaker travel, and other event expenses.')
    heading = document.add_heading('Images and supporting context', level=1); style_heading(heading)
    document.add_paragraph('Add images, captions, or supporting context here.')
    heading = document.add_heading('Event budget', level=1); style_heading(heading)
    table = document.add_table(rows=1, cols=3); table.style = 'Table Grid'
    for cell, heading in zip(table.rows[0].cells, ('Event name', 'Description', 'Budget amount (USD)')):
        cell.text = heading; set_table_font(cell, heading=True)
    for row in rows:
        cells = table.add_row().cells
        for cell, value in zip(cells, (row.get('name', ''), row.get('notes', ''), row.get('totalCost', '') or row.get('unitPrice', ''))):
            cell.text = str(value); set_table_font(cell)
    heading = document.add_heading('Calculated total', level=1); style_heading(heading)
    for currency, total in sorted(_money_subtotals(rows).items()):
        document.add_paragraph(f'{currency} {total:.2f}')
    output = BytesIO(); document.save(output)
    return output.getvalue()


def project_supporting_document(term, project_name, rows):
    """Build one editable DOCX whose line items are grouped by project category."""
    try:
        from docx import Document
        from docx.oxml import OxmlElement
        from docx.oxml.ns import qn
        from docx.shared import Inches, Pt, RGBColor
    except ModuleNotFoundError as error:
        raise RuntimeError('The DOCX export dependency is unavailable.') from error

    project_name = str(project_name or '').strip()
    rows = project_export_rows(rows, project_name)
    if not project_name or not rows:
        raise ValueError('This project has no saved Projects & Capital Items rows to export.')

    def add_link(paragraph, url):
        relation_id = paragraph.part.relate_to(url, 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink', is_external=True)
        hyperlink = OxmlElement('w:hyperlink'); hyperlink.set(qn('r:id'), relation_id)
        run = OxmlElement('w:r'); properties = OxmlElement('w:rPr')
        color = OxmlElement('w:color'); color.set(qn('w:val'), 'ED1C24')
        underline = OxmlElement('w:u'); underline.set(qn('w:val'), 'single')
        size = OxmlElement('w:sz'); size.set(qn('w:val'), '20')
        complex_size = OxmlElement('w:szCs'); complex_size.set(qn('w:val'), '20')
        properties.append(color); properties.append(underline); properties.append(size); properties.append(complex_size); run.append(properties)
        text = OxmlElement('w:t'); text.text = url; run.append(text)
        hyperlink.append(run); paragraph._p.append(hyperlink)

    def style_heading(paragraph, title=False):
        for run in paragraph.runs:
            run.bold = True
            run.font.color.rgb = RGBColor(0xED, 0x1C, 0x24)
        if title:
            properties = paragraph._p.get_or_add_pPr()
            borders = properties.find(qn('w:pBdr'))
            if borders is None:
                borders = OxmlElement('w:pBdr'); properties.append(borders)
            bottom = borders.find(qn('w:bottom'))
            if bottom is None:
                bottom = OxmlElement('w:bottom'); borders.append(bottom)
            bottom.set(qn('w:val'), 'single'); bottom.set(qn('w:sz'), '10')
            bottom.set(qn('w:space'), '1'); bottom.set(qn('w:color'), 'ED1C24')

    def set_table_font(cell, heading=False):
        for paragraph in cell.paragraphs:
            for run in paragraph.runs:
                run.font.size = Pt(10)
                if heading:
                    run.bold = True
                    run.font.color.rgb = RGBColor(0xED, 0x1C, 0x24)

    document = Document()
    section = document.sections[0]
    section.top_margin = section.bottom_margin = Inches(0.7)
    section.left_margin = section.right_margin = Inches(0.7)
    title = document.add_heading(f'{project_name} Supporting Documentation', level=0); style_heading(title, title=True)
    document.add_paragraph(f'Budget term: {term["label"]}')
    heading = document.add_heading('Project justification', level=1); style_heading(heading)
    document.add_paragraph('Add project justification here.')
    heading = document.add_heading('Images and supporting context', level=1); style_heading(heading)
    document.add_paragraph('Add images, captions, or supporting context here.')
    heading = document.add_heading('Line items by category', level=1); style_heading(heading)
    table = document.add_table(rows=1, cols=8); table.style = 'Table Grid'
    headers = ('Category', 'Line item', 'Vendor', 'Link', 'Unit price', 'Quantity', 'Total cost', 'Description / notes')
    for cell, label in zip(table.rows[0].cells, headers):
        cell.text = label; set_table_font(cell, heading=True)
    for category, category_rows in project_rows_by_category(rows):
        category_cell = None
        for row in category_rows:
            cells = table.add_row().cells
            if category_cell is None:
                category_cell = cells[0]; category_cell.text = category; set_table_font(category_cell, heading=True)
            else:
                category_cell = category_cell.merge(cells[0])
            values = (row.get('name', ''), row.get('vendor', ''), '', row.get('unitPrice', '') or '',
                      row.get('quantity', '') or '', row.get('totalCost', '') or '', row.get('notes', ''))
            for cell, value in zip(cells[1:], values):
                cell.text = str(value); set_table_font(cell)
            if row.get('link'):
                add_link(cells[3].paragraphs[0], row['link'])
    heading = document.add_heading('Calculated subtotals', level=1); style_heading(heading)
    for currency, total in sorted(_money_subtotals(rows).items()):
        document.add_paragraph(f'{currency} {total:.2f}')
    output = BytesIO(); document.save(output)
    return output.getvalue()
