from pathlib import Path

from kvasir_brain import KvasirBrain


def main() -> None:
    brain = KvasirBrain()
    sample_dir = Path("sample_data")
    if not sample_dir.exists():
        print("Missing sample_data directory.")
        return

    for file_path in sorted(sample_dir.iterdir()):
        if file_path.is_file():
            print(f"Ingesting {file_path}")
            brain.ingest_file(file_path)

    print("\nGraph nodes:")
    for node_id, data in brain.graph.nodes(data=True):
        print(f"- {data.get('label', node_id)} ({node_id})")

    print("\nGraph edges:")
    for src, tgt, data in brain.graph.edges(data=True):
        src_label = brain.graph.nodes[src].get("label", src)
        tgt_label = brain.graph.nodes[tgt].get("label", tgt)
        print(f"- {src_label} -[{data.get('predicate', '')}]-> {tgt_label}")

    print("\nNeighbors for 'Project Alpha':")
    for rel in brain.recall_structure("Project Alpha"):
        print(f"- {rel['subject']} -[{rel['predicate']}]-> {rel['object']}")

    print("\nVector recall for 'deadline next friday':")
    for item in brain.recall_vectors("deadline next friday", k=3):
        title = item["metadata"].get("subject") or item["metadata"].get("title") or "untitled"
        first_line = item["content"].splitlines()[0] if item["content"] else ""
        preview = first_line[:120]
        print(f"- {title}: {preview}")


if __name__ == "__main__":
    main()
