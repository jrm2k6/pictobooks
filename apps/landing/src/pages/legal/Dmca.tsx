import content from "../../../legal/dmca.md?raw";
import LegalPage from "../LegalPage";

export default function Dmca() {
  return (
    <LegalPage
      content={content}
      title="DMCA Policy"
      description="Review the Pictobook DMCA policy and process for copyright complaints and takedown requests."
      path="/legal/dmca"
    />
  );
}
