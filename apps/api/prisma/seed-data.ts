export const pipelineStages = [
  {
    key: "NEW",
    label: "New",
    order: 10,
    probability: 5,
    isClosed: false,
    isWon: false,
    isLost: false
  },
  {
    key: "CONTACTED",
    label: "Contacted",
    order: 20,
    probability: 10,
    isClosed: false,
    isWon: false,
    isLost: false
  },
  {
    key: "ENGAGED",
    label: "Engaged",
    order: 30,
    probability: 25,
    isClosed: false,
    isWon: false,
    isLost: false
  },
  {
    key: "QUALIFIED",
    label: "Qualified",
    order: 40,
    probability: 50,
    isClosed: false,
    isWon: false,
    isLost: false
  },
  {
    key: "MEETING_BOOKED",
    label: "Meeting Booked",
    order: 50,
    probability: 60,
    isClosed: false,
    isWon: false,
    isLost: false
  },
  {
    key: "PROPOSAL",
    label: "Proposal",
    order: 60,
    probability: 70,
    isClosed: false,
    isWon: false,
    isLost: false
  },
  {
    key: "NEGOTIATION",
    label: "Negotiation",
    order: 70,
    probability: 85,
    isClosed: false,
    isWon: false,
    isLost: false
  },
  {
    key: "WON",
    label: "Won",
    order: 80,
    probability: 100,
    isClosed: true,
    isWon: true,
    isLost: false
  },
  {
    key: "LOST",
    label: "Lost",
    order: 90,
    probability: 0,
    isClosed: true,
    isWon: false,
    isLost: true
  },
  {
    key: "NURTURE",
    label: "Nurture",
    order: 100,
    probability: 15,
    isClosed: false,
    isWon: false,
    isLost: false
  }
] as const;

export const defaultScoringConfig = {
  key: "default",
  requirementWeight: 20,
  authorityWeight: 20,
  budgetWeight: 20,
  timelineWeight: 20,
  businessFitWeight: 20,
  warmThreshold: 60,
  hotThreshold: 80
} as const;
