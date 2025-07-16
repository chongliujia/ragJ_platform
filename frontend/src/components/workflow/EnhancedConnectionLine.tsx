/**
 * 增强版连接线组件
 * 提供更直观的连接体验和动画效果
 */

import React from 'react';
import { getStraightPath } from 'reactflow';
import type { ConnectionLineComponentProps } from 'reactflow';

const EnhancedConnectionLine: React.FC<ConnectionLineComponentProps> = ({
  fromX,
  fromY,
  toX,
  toY,
  connectionLineStyle,
}) => {
  const [edgePath] = getStraightPath({
    sourceX: fromX,
    sourceY: fromY,
    targetX: toX,
    targetY: toY,
  });

  return (
    <g>
      {/* 底层阴影线 */}
      <path
        fill="none"
        stroke="rgba(0, 212, 255, 0.3)"
        strokeWidth={6}
        d={edgePath}
        strokeDasharray="5,5"
        strokeLinecap="round"
        style={{
          filter: 'blur(2px)',
          ...connectionLineStyle,
        }}
      />
      
      {/* 主连接线 */}
      <path
        fill="none"
        stroke="#00d4ff"
        strokeWidth={3}
        d={edgePath}
        strokeDasharray="5,5"
        strokeLinecap="round"
        style={{
          animation: 'dash 1s linear infinite',
          ...connectionLineStyle,
        }}
      />
      
      {/* 箭头 */}
      <defs>
        <marker
          id="connectionArrow"
          markerWidth="10"
          markerHeight="10"
          refX="9"
          refY="3"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <polygon
            points="0,0 0,6 9,3"
            fill="#00d4ff"
            style={{
              filter: 'drop-shadow(0 0 3px rgba(0, 212, 255, 0.5))',
            }}
          />
        </marker>
      </defs>
      
      {/* 添加动画样式 */}
      <style>
        {`
          @keyframes dash {
            to {
              stroke-dashoffset: -10;
            }
          }
        `}
      </style>
    </g>
  );
};

export default EnhancedConnectionLine;