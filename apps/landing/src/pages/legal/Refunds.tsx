import content from "../../../legal/refunds.md?raw";
import LegalPage from "../LegalPage";

export default function Refunds() {
  return (
    <LegalPage
      content={content}
      title="Refund Policy"
      description="Read the Pictobook refund policy for current waitlist, preorder, and future product purchase terms."
      path="/legal/refunds"
    />
  );
}
