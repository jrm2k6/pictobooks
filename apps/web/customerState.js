export const initialCustomerState = {
  draft: { childName: "Milo", age: 5, title: "Our days with Pippin" },
  email: "jamie@example.com",
  format: "print",
  approved: false,
  compare: false,
  resends: 0,
  removedSamples: [],
  photoOrder: [],
  files: [],
};

export function customerReducer(state, action) {
  switch (action.type) {
    case "draft/updated":
      return { ...state, draft: { ...state.draft, ...action.partial } };
    case "email/updated":
      return { ...state, email: action.email };
    case "email/resent":
      return { ...state, resends: state.resends + 1 };
    case "photos/added":
      return { ...state, files: [...state.files, ...action.files].slice(0, action.maxUserFiles) };
    case "photo/removed":
      return {
        ...state,
        removedSamples: action.sample
          ? [...state.removedSamples, action.id]
          : state.removedSamples,
        files: action.sample ? state.files : state.files.filter((file) => file.id !== action.id),
        photoOrder: state.photoOrder.filter((id) => id !== action.id),
      };
    case "photos/reordered":
      return { ...state, photoOrder: action.ids };
    case "edition/selected":
      return { ...state, format: action.format };
    case "review/compared":
      return { ...state, compare: !state.compare };
    case "review/approved":
      return { ...state, approved: true };
    default:
      return state;
  }
}
