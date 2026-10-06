import { Redirect } from 'expo-router';
import React from 'react';

import RoutePreviewScreen from '../../screens/dev/route-preview-screen';

/** Dev-only (M6-T4 routing proof): release builds redirect home. */
export default function DevRoutePreviewRoute() {
  if (!__DEV__) {
    return <Redirect href="/" />;
  }
  return <RoutePreviewScreen />;
}
