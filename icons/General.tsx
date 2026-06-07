import React from 'react';
import { 
  Search as LucideSearch, 
  HelpCircle as LucideHelpCircle, 
  Sparkles as LucideSparkles, 
  Check as LucideCheck, 
  Map as LucideMap, 
  Lightbulb as LucideLightbulb, 
  Clock as LucideClock, 
  Compass as LucideCompass, 
  Calendar as LucideCalendar, 
  Table as LucideTable, 
  Info as LucideInfo, 
  Tag as LucideTag, 
  Link as LucideLink 
} from 'lucide-react';
import { IconProps } from './types';

export const Search: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucideSearch size={size} color={color} strokeWidth={strokeWidth} {...props} />
);

export const HelpCircle: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucideHelpCircle size={size} color={color} strokeWidth={strokeWidth} {...props} />
);

export const Sparkles: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucideSparkles size={size} color={color} strokeWidth={strokeWidth} {...props} />
);

export const Check: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucideCheck size={size} color={color} strokeWidth={strokeWidth} {...props} />
);

export const Map: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucideMap size={size} color={color} strokeWidth={strokeWidth} {...props} />
);

export const Lightbulb: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucideLightbulb size={size} color={color} strokeWidth={strokeWidth} {...props} />
);

export const Clock: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucideClock size={size} color={color} strokeWidth={strokeWidth} {...props} />
);

export const Compass: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucideCompass size={size} color={color} strokeWidth={strokeWidth} {...props} />
);

export const Calendar: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucideCalendar size={size} color={color} strokeWidth={strokeWidth} {...props} />
);

export const Table: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucideTable size={size} color={color} strokeWidth={strokeWidth} {...props} />
);

export const Info: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucideInfo size={size} color={color} strokeWidth={strokeWidth} {...props} />
);

export const Tag: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucideTag size={size} color={color} strokeWidth={strokeWidth} {...props} />
);

export const Link: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucideLink size={size} color={color} strokeWidth={strokeWidth} {...props} />
);
