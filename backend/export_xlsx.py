"""
Pure Python OpenXML (.xlsx) Generator for KiotPro.
Built strictly with Python standard library (zipfile, xml.sax.saxutils, io).
Zero third-party dependencies required.
"""

import io
import zipfile
import xml.sax.saxutils as saxutils

def get_col_letter(col_idx: int) -> str:
    """Convert 1-based column index to Excel column letters (A, B, ..., Z, AA, AB, ...)."""
    result = ""
    while col_idx > 0:
        col_idx, remainder = divmod(col_idx - 1, 26)
        result = chr(65 + remainder) + result
    return result

def create_xlsx(sheet_name: str, headers: list, rows: list) -> bytes:
    """
    Generate valid XLSX bytes from headers and rows.
    sheet_name: str
    headers: list of str
    rows: list of list of values (str, int, float, None)
    """
    output = io.BytesIO()
    
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as zf:
        # [Content_Types].xml
        content_types = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>"""
        zf.writestr('[Content_Types].xml', content_types)

        # _rels/.rels
        root_rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>"""
        zf.writestr('_rels/.rels', root_rels)

        # xl/_rels/workbook.xml.rels
        wb_rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>"""
        zf.writestr('xl/_rels/workbook.xml.rels', wb_rels)

        # xl/workbook.xml
        safe_sheet_name = saxutils.escape(sheet_name[:31] or "Sheet1")
        workbook = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="{safe_sheet_name}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>"""
        zf.writestr('xl/workbook.xml', workbook)

        # xl/styles.xml (0: regular cell, 1: bold header with gray background, 2: number)
        styles = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><name val="Arial"/><sz val="10"/></font>
    <font><b/><color rgb="FF0F172A"/><name val="Arial"/><sz val="10"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFE2E8F0"/></left>
      <right style="thin"><color rgb="FFE2E8F0"/></right>
      <top style="thin"><color rgb="FFE2E8F0"/></top>
      <bottom style="thin"><color rgb="FFE2E8F0"/></bottom>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="3">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="2" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
  </cellXfs>
</styleSheet>"""
        zf.writestr('xl/styles.xml', styles)

        # xl/worksheets/sheet1.xml
        sheet_rows = []
        
        # Header row (row 1)
        r_idx = 1
        h_cells = []
        for c_idx, h in enumerate(headers, 1):
            col_letter = get_col_letter(c_idx)
            val = saxutils.escape(str(h) if h is not None else "")
            h_cells.append(f'<c r="{col_letter}{r_idx}" t="inlineStr" s="1"><is><t>{val}</t></is></c>')
        sheet_rows.append(f'<row r="{r_idx}">{"".join(h_cells)}</row>')

        # Data rows
        for row in rows:
            r_idx += 1
            d_cells = []
            for c_idx, val in enumerate(row, 1):
                col_letter = get_col_letter(c_idx)
                if val is None or val == "":
                    continue
                elif isinstance(val, (int, float)):
                    d_cells.append(f'<c r="{col_letter}{r_idx}" s="0"><v>{val}</v></c>')
                else:
                    s_val = saxutils.escape(str(val))
                    d_cells.append(f'<c r="{col_letter}{r_idx}" t="inlineStr" s="0"><is><t>{s_val}</t></is></c>')
            sheet_rows.append(f'<row r="{r_idx}">{"".join(d_cells)}</row>')

        sheet_xml = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    {"".join(sheet_rows)}
  </sheetData>
</worksheet>"""
        zf.writestr('xl/worksheets/sheet1.xml', sheet_xml)

    output.seek(0)
    return output.getvalue()
