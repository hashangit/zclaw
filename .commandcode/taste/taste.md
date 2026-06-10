# Taste (Continuously Learned by [CommandCode][cmd])

[cmd]: https://commandcode.ai/

# workflow
- After implementing significant code changes, run a formal QA/scrutinize review following the 4-step process: Intent (state goal, ask if simpler alternative exists), Trace (walk actual code paths end-to-end), Verify (confirm each claim, find edge cases), Report (findings ordered by severity: blocker → major → nit, with evidence and suggested fix, closing with one-line verdict). Confidence: 0.70
- When writing findings or content to a file that may already exist, first check if it has existing content and append/edit instead of overwriting. Confidence: 0.75
