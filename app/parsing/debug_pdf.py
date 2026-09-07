from pathlib import Path

from app.parsing.pdf_parser import extract_paragraphs


PDF_PATH = Path(r"D:\Code\Python\knowledge-base-rag-main\data\7648_2、PTP-012-博腾员工手册 -2022.pdf")


def main():
    paragraphs = extract_paragraphs(str(PDF_PATH))

    print(f"PDF: {PDF_PATH}")
    print(f"共解析出 {len(paragraphs)} 个 paragraph")
    print("=" * 80)

    for p in paragraphs:
        print(
            f"[page={p.page_number}, paragraph={p.paragraph_index}]"
        )
        print(p.text)
        print("-" * 80)


if __name__ == "__main__":
    main()