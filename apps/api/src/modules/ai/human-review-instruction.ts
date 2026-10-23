export function humanReviewInstruction(operation: string): string {
  if (operation !== "follow_up") {
    return "Recommend human review for sensitive, enterprise or uncertain requests.";
  }
  return "For follow-ups, assess the proposed message itself and unresolved customer requests. Asking the customer to clarify their budget, decision-maker, requirements or availability is routine discovery and does not require human review by itself. A large company or custom project alone does not require review. Set requiresHumanReview to false for a grounded discovery reminder with no commercial commitments. Require human review for unresolved negotiation, discount, pricing, legal or other high-risk requests, or if the proposed message makes an unapproved commercial commitment, unsupported claim or delivery guarantee. When review is required, explain the specific reason in reason. A customer target date is planning context, never a delivery commitment.";
}
