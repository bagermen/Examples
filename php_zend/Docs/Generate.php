<?php
/**
 * Class Model_Docs_Generate
 * Фабрика генерации отчетов для газа и общей
 * Позволяет разгрузить контроллеры,
 * убрать зависимость от типа площадки.
 */
class Model_Docs_Generate
{
  /**
   * @param array $opts - массив опций для генерации отчета:
   * $opts = array (
   *   "filename" => Имя файла для генерации (default: file.rtf)
   *   "tpl" => Обработчик данных отчета
   *   "time" => Опция позволяет добавить дату и время генерации в название файла (default: false)
   * )
   *
   * @param array  $data - массив данных, по которым получаем отчет
   * @param string $optfile - имя файла настроек для генератора RTF (default: rtf_config.inc)
   * @return bool - выводит false в случае неудачи
   */
  public static function generate($opts, $data, $optfile = 'rtf_config.inc') {
    $result = false;
    $opts = (array) $opts;
    $data = (array) $data;

    $opts = array(
      "filename" => array_key_exists("filename", $opts) ? $opts["filename"] : "file.rtf",
      "tpl" => array_key_exists("tpl", $opts) ? $opts["tpl"] : "",
      "time" => array_key_exists("time", $opts) ? $opts["time"] : false
    );

    $finfo = pathinfo($opts["filename"]);
    $name = $finfo["filename"];
    if ($opts["time"]) {
      $cur_date = toZendDate('now');
      $name .= "_" . $cur_date->get(getTimeFormat('datetimef'));
    }
    $opts["filename"] = $name . "." . $finfo["extension"];

    $tpl = ucfirst(strtolower($opts["tpl"]));
    $postfix = isEtpGazprom() ? 'Gaz' : 'Etp';
    $class = 'Model_Docs_' . $postfix . "_" . $tpl;

    try {
      if (class_exists($class)) {
        $template = new $class($data);
        $template->prepare();
        self::renderTpl($opts["filename"], $template, $optfile);
      }

      return $result;
    } catch (ResponseException $e) {
      return array(
        'success' => false,
        'message' => $e->getMessage()
      );
    }
  }

  private static function renderTpl($filename, Model_Docs_Interface $template, $optfile) {
    $tpl_data = Core_Template::dbProcess($template->getTemplate(), $template->getData());
    $content = $tpl_data['message'];
    exportRTF($content, $filename, $optfile);
  }
}