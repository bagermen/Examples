<?php

class filenameTest extends ApplicationTestCase {

  /**
   * @param $fileName
   * @param $needDot
   * @param $expected
   * @dataProvider providerCheckFileName
   */
  public function testCheckFileName($fileName, $needDot, $expected)
  {

    $this->assertEquals(checkFileName($fileName, $needDot), $expected);
  }

  public function providerCheckFileName()
  {
    return array(
      array(null, false, false),
      array('name', false, true),
      array('name.xx', false, true),
      array('../name.xx', false, false),
      array('name.php', false, false),
      array('name', true, false),
      array('name.xx', true, true),
      array('name.php', true, false),
      array('../name.xx', true, false)
    );
  }

  /**
   * @dataProvider providerCheckClassName
   */
  public function testCheckClassName($className, $classList, $expected)
  {
    $this->assertEquals(checkClassName($className, $classList), $expected);
  }

  public function providerCheckClassName()
  {
    return array(
      array(null, array(), false),
      array(null, array('name'), false),
      array('name', array(), true),
      array('name', array('name'), true),
      array('name1', array('name'), false),
      array('name.xx', array('name'), false),
      array('name.xx', array(), false),
      array('../name', array(), false),
      array('name.php', array(), false)
    );
  }
}