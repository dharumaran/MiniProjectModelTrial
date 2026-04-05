import React from 'react';
import { render } from '@testing-library/react-native';
import GestureWrapper from '../GestureWrapper';
import { Text } from 'react-native';

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn() }),
}));

jest.mock('../../hooks/useBehaviorCsvCapture', () => ({
  recordTouchSnapshot: jest.fn(),
}));

describe('GestureWrapper', () => {
  it('renders children correctly', () => {
    const { getByText } = render(
      <GestureWrapper>
        <Text>Test Child</Text>
      </GestureWrapper>
    );

    expect(getByText('Test Child')).toBeTruthy();
  });
});
