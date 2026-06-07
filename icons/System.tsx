import React from 'react';
import { 
  Printer as LucidePrinter, 
  AlertTriangle as LucideAlertTriangle, 
  Moon as LucideMoon, 
  Sun as LucideSun, 
  LayoutGrid as LucideLayoutGrid, 
  ThumbsUp as LucideThumbsUp, 
  ThumbsDown as LucideThumbsDown, 
  Code as LucideCode 
} from 'lucide-react';
import { IconProps } from './types';

export const Printer: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucidePrinter size={size} color={color} strokeWidth={strokeWidth} {...props} />
);

export const AlertTriangle: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucideAlertTriangle size={size} color={color} strokeWidth={strokeWidth} {...props} />
);

export const Github: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucideCode size={size} color={color} strokeWidth={strokeWidth} {...props} />
);

export const Moon: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucideMoon size={size} color={color} strokeWidth={strokeWidth} {...props} />
);

export const Sun: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucideSun size={size} color={color} strokeWidth={strokeWidth} {...props} />
);

export const LayoutGrid: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucideLayoutGrid size={size} color={color} strokeWidth={strokeWidth} {...props} />
);

export const ThumbsUp: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucideThumbsUp size={size} color={color} strokeWidth={strokeWidth} {...props} />
);

export const ThumbsDown: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucideThumbsDown size={size} color={color} strokeWidth={strokeWidth} {...props} />
);

export const Code: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucideCode size={size} color={color} strokeWidth={strokeWidth} {...props} />
);
