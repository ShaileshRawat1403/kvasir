from pathlib import Path

from kvasir_brain import KvasirBrain


def main() -> None:
    try:
        brain = KvasirBrain(verbose=True)
    except RuntimeError as e:
        print(f"Error initializing KvasirBrain: {e}")
        print("Please ensure Neo4j is running and connection details are set in your environment.")
        return

    sample_dir = Path("sample_data")
    if not sample_dir.exists():
        print("Missing sample_data directory.")
        brain.close()
        return

    print("--- Ingesting sample data ---")
    for file_path in sorted(sample_dir.iterdir()):
        if file_path.is_file():
            print(f"Ingesting {file_path}...")
            brain.ingest_file(file_path)
    print("--- Ingestion complete ---\n")


    print("--- Recall examples ---")
    print("\nNeighbors for 'Project Alpha':")
    try:
        for rel in brain.recall_structure("Project Alpha"):
            print(f"- {rel['subject']} -[{rel['predicate']}]-> {rel['object']}")
    except Exception as e:
        print(f"Error recalling structure: {e}")


    print("\nVector recall for 'deadline next friday':")
    try:
        for item in brain.recall_vectors("deadline next friday", k=3):
            metadata = item.get("metadata", {})
            title = metadata.get("subject") or metadata.get("title") or "untitled"
            first_line = item["content"].splitlines()[0] if item["content"] else ""
            preview = first_line[:120]
            print(f"- {title}: {preview}")
    except Exception as e:
        print(f"Error recalling vectors: {e}")

    finally:
        print("\n--- Demo finished, closing connections ---")
        brain.close()


if __name__ == "__main__":
    main()
