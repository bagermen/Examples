<?php

class Model_Fasade_LotTest extends ApplicationTestCase {

  /**
   * @dataProvider providerStepMoreOrEqualTo
   * @param $cur_step
   */
  public function testStepMoreOrEqualTo($cur_step) {
    $lot = $this->getMockBuilder('Model_Lot')
      ->disableOriginalConstructor()
      ->getMock();
    $step_id = 'second_parts';
    $step_id_not_exist = 'not_exist_step';
    $lot_steps = array(
      array('id' => 1, 'step_id' => 'first_parts'),
      array('id' => 2, 'step_id' => $step_id),
      array('id' => 3, 'step_id' => 'last_parts'),
    );

    $lot->expects($this->any())->method('getSteps')->will($this->returnValue($lot_steps));
    $lot->expects($this->any())->method('__call')->with('getCurrentStep')->will($this->returnValue($cur_step));

    $this->assertFalse(Model_Fasade_Lot::stepMoreOrEqualTo($lot, $step_id_not_exist));

    if ($cur_step == 3) {
      $this->assertFalse(Model_Fasade_Lot::stepMoreOrEqualTo($lot, $step_id));
    } else {
      $this->assertTrue(Model_Fasade_Lot::stepMoreOrEqualTo($lot, $step_id));
    }
  }

  public function providerStepMoreOrEqualTo() {
    return array(
      array(1),
      array(2),
      array(3),
      array(null)
    );
  }
}