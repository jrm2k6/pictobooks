import content from "../../../legal/acceptable-use.md?raw";
import LegalPage from "../LegalPage";

export default function AcceptableUse() {
  return (
    <LegalPage
      content={content}
      title="Acceptable Use Policy"
      description="Read the Pictobook acceptable use policy for prohibited activity and responsible use of the service."
      path="/legal/acceptable-use"
    />
  );
}
