import React from 'react';

export interface IconProps extends React.ComponentPropsWithoutRef<'svg'> {
  size?: number | string;
  color?: string;
  strokeWidth?: number | string;
}
