import React from 'react';
import { 
  Database as LucideDatabase, 
  FileText as LucideFileText, 
  Activity as LucideActivity, 
  Terminal as LucideTerminal, 
  CheckSquare as LucideCheckSquare, 
  Box as LucideBox, 
  Briefcase as LucideBriefcase, 
  GitCommit as LucideGitCommit, 
  Disc as LucideDisc, 
  StickyNote as LucideStickyNote, 
  Cpu as LucideCpu, 
  Eye as LucideEye, 
  Layers3 as LucideLayers3, 
  Layers as LucideLayers,
  Package as LucidePackage
} from 'lucide-react';
import { IconProps } from './types';

export const Database: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucideDatabase size={size} color={color} strokeWidth={strokeWidth} {...props} />
);

export const FileText: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucideFileText size={size} color={color} strokeWidth={strokeWidth} {...props} />
);

export const Activity: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucideActivity size={size} color={color} strokeWidth={strokeWidth} {...props} />
);

export const Terminal: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucideTerminal size={size} color={color} strokeWidth={strokeWidth} {...props} />
);

export const CheckSquare: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucideCheckSquare size={size} color={color} strokeWidth={strokeWidth} {...props} />
);

export const Box: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucideBox size={size} color={color} strokeWidth={strokeWidth} {...props} />
);

export const Briefcase: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucideBriefcase size={size} color={color} strokeWidth={strokeWidth} {...props} />
);

export const GitCommit: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucideGitCommit size={size} color={color} strokeWidth={strokeWidth} {...props} />
);

export const Disc: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucideDisc size={size} color={color} strokeWidth={strokeWidth} {...props} />
);

export const StickyNote: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucideStickyNote size={size} color={color} strokeWidth={strokeWidth} {...props} />
);

export const Cpu: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucideCpu size={size} color={color} strokeWidth={strokeWidth} {...props} />
);

export const Eye: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucideEye size={size} color={color} strokeWidth={strokeWidth} {...props} />
);

export const Layers3: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucideLayers3 size={size} color={color} strokeWidth={strokeWidth} {...props} />
);

export const Layers: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucideLayers size={size} color={color} strokeWidth={strokeWidth} {...props} />
);

export const Package: React.FC<IconProps> = ({ size = 18, color, strokeWidth, ...props }) => (
  <LucidePackage size={size} color={color} strokeWidth={strokeWidth} {...props} />
);
