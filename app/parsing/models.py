from dataclasses import dataclass


@dataclass(frozen=True)
class Paragraph:
    page_number: int
    paragraph_index: int
    text: str
    # Layout-derived structure retained by the PDF parser. Empty heading_path
    # means the paragraph belongs to the document preamble or the parser could
    # not identify a reliable heading boundary.
    heading_path: tuple[str, ...] = ()
    heading_occurrence: int = 0
    is_heading: bool = False
    heading_level: int | None = None
    font_size: float | None = None
    is_bold: bool | None = None
