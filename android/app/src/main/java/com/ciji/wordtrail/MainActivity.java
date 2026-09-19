package com.ciji.wordtrail;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(CijiUpdaterPlugin.class);
    super.onCreate(savedInstanceState);
  }
}
