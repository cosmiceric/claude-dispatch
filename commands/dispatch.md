Toggle Dispatch (Discord notifications + remote approvals) on or off.

When the user runs /dispatch, check the current state by reading ~/.dispatch-enabled. If the file contains "true", write "false" to it. If it contains "false" or doesn't exist, write "true" to it.

Report the new state to the user:
- ON: "Dispatch ON — tool approvals will be sent to Discord"
- OFF: "Dispatch OFF — normal local prompts"

Use the Bash tool to read and write the file. Do not use any other tools.

When turning Dispatch ON, also tell the user:

"While Dispatch is on, I'll always end my responses with either a tool call or a question so you can respond from Discord."

Then follow this rule for the rest of the session: **When Dispatch is enabled, never end a response with just text. Always end with either a tool use (which triggers Discord approval) or an AskUserQuestion (which triggers a Discord question prompt).** This ensures you can always respond from Discord when AFK. If there's nothing left to do, ask "Anything else?" via AskUserQuestion.
