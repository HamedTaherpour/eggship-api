import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import {
  InvalidIranianPhoneError,
  normalizeIranianPhone,
} from '../../users/domain/iranian-phone';

@ValidatorConstraint({ name: 'isIranianMobilePhone', async: false })
export class IsIranianMobilePhoneConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') {
      return false;
    }
    try {
      normalizeIranianPhone(value);
      return true;
    } catch (error: unknown) {
      if (error instanceof InvalidIranianPhoneError) {
        return false;
      }
      throw error;
    }
  }

  defaultMessage(): string {
    return 'phone must be a valid Iranian mobile number';
  }
}

export function IsIranianMobilePhone(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (object: object, propertyName: string | symbol): void => {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName.toString(),
      options: validationOptions,
      constraints: [],
      validator: IsIranianMobilePhoneConstraint,
    });
  };
}
