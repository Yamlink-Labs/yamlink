import React from 'react';
import { 
  ChevronDown as LucideChevronDown, 
  ChevronRight as LucideChevronRight, 
  ChevronLeft as LucideChevronLeft, 
  ArrowLeft as LucideArrowLeft, 
  ArrowRight as LucideArrowRight, 
  ArrowUpRight as LucideArrowUpRight, 
  ArrowDownLeft as LucideArrowDownLeft, 
  Home as LucideHome, 
  BookOpen as LucideBookOpen, 
  Grid as LucideGrid, 
  AlignLeft as LucideAlignLeft 
} from 'lucide-react';
import { IconProps } from './types';

export const ChevronDown: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucideChevronDown size={size} color={color} strokeWidth={strokeWidth} {...props} />
);

export const ChevronRight: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucideChevronRight size={size} color={color} strokeWidth={strokeWidth} {...props} />
);

export const ChevronLeft: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucideChevronLeft size={size} color={color} strokeWidth={strokeWidth} {...props} />
);

export const ArrowLeft: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucideArrowLeft size={size} color={color} strokeWidth={strokeWidth} {...props} />
);

export const ArrowRight: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucideArrowRight size={size} color={color} strokeWidth={strokeWidth} {...props} />
);

export const ArrowUpRight: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucideArrowUpRight size={size} color={color} strokeWidth={strokeWidth} {...props} />
);

export const ArrowDownLeft: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucideArrowDownLeft size={size} color={color} strokeWidth={strokeWidth} {...props} />
);

export const Home: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucideHome size={size} color={color} strokeWidth={strokeWidth} {...props} />
);

export const BookOpen: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucideBookOpen size={size} color={color} strokeWidth={strokeWidth} {...props} />
);

export const Grid: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucideGrid size={size} color={color} strokeWidth={strokeWidth} {...props} />
);

export const AlignLeft: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucideAlignLeft size={size} color={color} strokeWidth={strokeWidth} {...props} />
);
