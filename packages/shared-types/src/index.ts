export type ServiceName = "api" | "worker" | "web";

export interface HealthResponse {
  status: "ok";
  service: ServiceName;
  uptimeSeconds: number;
  timestamp: string;
}

export interface WorkerStatus {
  status: "ok";
  service: "worker";
  queuesEnabled: boolean;
  redisUrlConfigured: boolean;
}

export const USER_ROLES = ["ADMIN", "SALES_MANAGER", "SALES_REP"] as const;
export type UserRoleName = (typeof USER_ROLES)[number];

export const USER_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type UserStatusName = (typeof USER_STATUSES)[number];

export interface PublicUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRoleName;
  status: UserStatusName;
  createdAt: string;
  updatedAt: string;
}

export interface AuthResponse {
  accessToken: string;
  user: PublicUser;
}

export interface CompanyDto {
  id: string;
  name: string;
  website: string | null;
  normalizedWebsite: string | null;
  industry: string | null;
  location: string | null;
  employeeRange: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContactDto {
  id: string;
  companyId: string;
  firstName: string;
  lastName: string;
  title: string | null;
  email: string | null;
  normalizedEmail: string | null;
  phone: string | null;
  normalizedPhone: string | null;
  whatsappId: string | null;
  source: string | null;
  preferredChannel: string | null;
  doNotContact: boolean;
  createdAt: string;
  updatedAt: string;
}

export const LEAD_STATUSES = ["OPEN", "WON", "LOST", "NURTURE", "DISQUALIFIED"] as const;
export type LeadStatusName = (typeof LEAD_STATUSES)[number];

export const LEAD_TEMPERATURES = ["HOT", "WARM", "NURTURE"] as const;
export type LeadTemperatureName = (typeof LEAD_TEMPERATURES)[number];

export interface PipelineStageDto {
  id: string;
  key: string;
  label: string;
  order: number;
  probability: number;
  isClosed: boolean;
  isWon: boolean;
  isLost: boolean;
}

export interface LeadDto {
  id: string;
  companyId: string;
  contactId: string;
  ownerId: string | null;
  source: string;
  status: LeadStatusName;
  stageId: string;
  requirement: string | null;
  serviceInterest: string | null;
  score: number;
  temperature: LeadTemperatureName;
  estimatedValue: string | null;
  currency: string;
  nextAction: string | null;
  nextActionAt: string | null;
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
  company: CompanyDto;
  contact: ContactDto;
  owner: PublicUser | null;
  stage: PipelineStageDto;
}

export interface PaginatedResponse<TItem> {
  items: TItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
