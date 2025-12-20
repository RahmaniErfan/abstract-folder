
import os

def create_template(base_path):
    """
    Creates a structured template folder with university, work, and personal notes.
    """
    template = {
        "University": {
            "Semester 1": {
                "Computer Science 101": ["Syllabus.md", "Notes.md", "Assignment_1.md"],
                "Mathematics": ["Calculus_Notes.md", "Formula_Sheet.md"],
                "Physics": ["Lab_Report.md"]
            },
            "Resources": ["Library_Links.md", "Student_Handbook.md"]
        },
        "Work": {
            "Projects": {
                "Alpha": ["Spec.md", "Timeline.md"],
                "Beta": ["Feedback.md"]
            },
            "Meetings": ["Weekly_Sync.md", "One_on_One.md"],
            "Admin": ["Timesheet.md", "Expenses.md"]
        },
        "Notes": {
            "Reading List": ["Books_to_Read.md", "Articles.md"],
            "Ideas": ["App_Idea.md", "Blog_Posts.md"],
            "Journal": ["2024-01-01.md"]
        },
        "Archive": {}
    }

    def build_structure(current_path, structure):
        for name, content in structure.items():
            path = os.path.join(current_path, name)
            if isinstance(content, dict):
                os.makedirs(path, exist_ok=True)
                print(f"Created folder: {path}")
                build_structure(path, content)
            elif isinstance(content, list):
                os.makedirs(path, exist_ok=True)
                print(f"Created folder: {path}")
                for file_name in content:
                    file_path = os.path.join(path, file_name)
                    with open(file_path, "w") as f:
                        f.write(f"# {file_name.replace('.md', '').replace('_', ' ')}\n\nTemplate content for {file_name}.")
                    print(f"Created file: {file_path}")

    print(f"Starting template generation in {base_path}...")
    build_structure(base_path, template)
    print("Finished generating template.")

if __name__ == "__main__":
    current_script_dir = os.path.dirname(os.path.abspath(__file__))
    # Target is the root of the vault (3 levels up from plugins/abstract-folder)
    target_vault_dir = os.path.abspath(os.path.join(current_script_dir, "../../.."))
    
    # We'll put the template in a "Template" subfolder to avoid cluttering the root directly
    template_root = os.path.join(target_vault_dir, "Template_Vault")
    
    create_template(template_root)
