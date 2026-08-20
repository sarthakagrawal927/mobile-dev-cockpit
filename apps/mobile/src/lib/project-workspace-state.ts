export type ProjectSection =
  | "control"
  | "preview"
  | "agent"
  | "review"
  | "deploy";

export interface ProjectWorkspaceState {
  section: ProjectSection;
  instruction: string;
}

export const initialProjectWorkspaceState: ProjectWorkspaceState = {
  section: "control",
  instruction: "",
};

export type ProjectWorkspaceAction =
  | { type: "selectSection"; section: ProjectSection }
  | { type: "setInstruction"; instruction: string }
  | { type: "appendTranscript"; transcript: string }
  | { type: "clearInstruction" }
  | { type: "layoutChanged" };

export function projectWorkspaceReducer(
  state: ProjectWorkspaceState,
  action: ProjectWorkspaceAction,
): ProjectWorkspaceState {
  switch (action.type) {
    case "selectSection":
      return { ...state, section: action.section };
    case "setInstruction":
      return { ...state, instruction: action.instruction };
    case "appendTranscript": {
      const transcript = action.transcript.trim();
      if (!transcript) return state;
      return {
        ...state,
        instruction: state.instruction.trim()
          ? `${state.instruction.trim()}\n${transcript}`
          : transcript,
      };
    }
    case "clearInstruction":
      return { ...state, instruction: "" };
    case "layoutChanged":
      return state;
  }
}
