export interface ValidationResult<TValue> {
  success: boolean;
  value?: TValue;
  errors?: string[];
}
