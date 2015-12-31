<?php

/**
 * Created by PhpStorm.
 * User: Roman
 * Date: 01.02.14
 * Time: 14:01
 */
interface Model_Docs_Interface
{
  /**
   * Подготовка массива данных для рендеринга в темплейте
   */
  function prepare();

  /**
   * Возвращает массив данных
   * @return array
   */
  function getData();

  /**
   * Устанавливает массив данных
   * @param array $data - массив данных
   * @return $this
   */
  function setData($data);

  /**
   * Возвращает имя темплейта для рендеринга
   * @return string
   * @return @this
   */
  function getTemplate();

  /**
   * Устанавливает имя темплейта для рендеринга
   * @param string $tpl - темплейт
   */
  function setTemplate($tpl);
}