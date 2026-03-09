import { SetMetadata } from '@nestjs/common';

export const IS_ANALYST_KEY = 'isAnalyst';
export const IsAnalyst = () => SetMetadata(IS_ANALYST_KEY, true);
